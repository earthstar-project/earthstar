import {
    AuthorAddress,
    Document,
    WorkspaceAddress,
} from '../util/types';
import {
    Query3,
    cleanUpQuery,
    historySortFn,
    queryMatchesDoc,
} from './query3';
import {
    Storage3Base,
} from './storage3Base';

//================================================================================

export class Storage3Memory extends Storage3Base {
    _docs: Record<string, Record<string, Document>> = {};  // { path: { author: document }}
    _config: Record<string, string> = {};

    setConfig(key: string, content: string): void {
        this._config[key] = content;
    }
    getConfig(key: string): string | undefined {
        return this._config[key];
    }
    deleteConfig(key: string): void {
        delete this._config[key];
    }
    deleteAllConfig(): void {
        this._config = {};
    }

    documents(q?: Query3): Document[] {
        this._assertNotClosed();
        let query = cleanUpQuery(q || {});

        if (query.limit === 0 || query.limitBytes === 0) { return []; }

        let now = this._now || (Date.now() * 1000);
        let results: Document[] = [];

        let pathsToConsider = Object.keys(this._docs);

        /*
        // TODO: enable these optimizations
        // which paths should we consider?
        let pathsToConsider: string[];
        if (query.path !== undefined) {
            // optimize when a specific path is requested
            if (this._docs[query.path] === undefined) { return []; }
            pathsToConsider = [query.path];
        } else {
            // TODO: consider optimizing this more by filtering by pathPrefix here.  benchmark it
            pathsToConsider = Object.keys(this._docs);
        }
        */

        for (let path of pathsToConsider) {
            // within one path...
            let pathSlots = this._docs[path];
            let docsThisPath = Object.values(pathSlots);

            if (query.history === 'latest') {
                // only keep head
                docsThisPath.sort(historySortFn);  // TODO: would be better to sort on insertion instead of read
                docsThisPath = [docsThisPath[0]];
            } else if (query.history === 'all') {
                // keep all docs at this path
            }

            // apply the rest of the individual query selectors: path, timestamp, author, contentSize
            // and skip expired ephemeral docs
            docsThisPath = docsThisPath
                .filter(doc => queryMatchesDoc(query, doc) && (doc.deleteAfter === null || now <= doc.deleteAfter));

            docsThisPath
                .forEach(doc => results.push(doc));

            // TODO: optimize this:
            // if sort == 'path' and there's a limit,
            // we could sort pathsToConsider, then if
            // if we finish one path's documents and either of the
            // limits are exceeded, we can bail out of this loop
            // early.  We still have to do the sorting and careful
            // limit checks below, though.
        }

        results.sort(historySortFn);

        // apply limit and limitBytes
        if (query.limit !== undefined) {
            results = results.slice(0, query.limit);
        }

        if (query.limitBytes !== undefined) {
            let bytes = 0;
            for (let ii = 0; ii < results.length; ii++) {
                let doc = results[ii];
                // count content length in bytes in utf-8 encoding, not number of characters
                // TODO: test this works in browsers
                // https://stackoverflow.com/questions/5515869/string-length-in-bytes-in-javascript
                let len = Buffer.byteLength(doc.content, 'utf-8');
                bytes += len;
                // if we hit limitBytes but the next item's content is '',
                // return early (don't include the empty item)
                if (bytes > query.limitBytes || (bytes === query.limitBytes && len === 0)) {
                    results = results.slice(0, ii);
                    break;
                }
            }
        }

        return results;
    }

    _upsertDocument(doc: Document): void {
        this._assertNotClosed();
        Object.freeze(doc);
        let slots: Record<string, Document> = this._docs[doc.path] || {};
        slots[doc.author] = doc;
        this._docs[doc.path] = slots;
    }

    removeExpiredDocuments(now: number): void {
        this._assertNotClosed();
        // using "for... in" on purpose since we're deleting while iterating
        for (let path in this._docs) {
            let slots = this._docs[path];
            // delete expired docs from slots
            for (let author in slots) {
                let doc = slots[author];
                if (doc.deleteAfter !== null && doc.deleteAfter < now) {
                    delete slots[author];
                }
            }
            // if slots are empty, remove the entire set of slots
            if (Object.keys(slots).length === 0) {
                delete this._docs[path];
            }
        }
    }

    removeAndClose(): void {
        this._docs = {};
        this._config = {};
        this.close();
    }

    /*
    documents(query: QueryOpts2, now: number): Document[] {
        query = cleanUpQuery(query);

        if (query.limit === 0 || query.limitBytes === 0) { return []; }

        let results: Document[] = [];

        // which paths should we consider?
        let pathsToConsider: string[];
        if (query.path !== undefined) {
            // optimize when a specific path is requested
            if (this._docs[query.path] === undefined) { return []; }
            pathsToConsider = [query.path];
        } else {
            // TODO: consider optimizing this more by filtering by pathPrefix here.  benchmark it
            pathsToConsider = Object.keys(this._docs);
        }

        for (let path of pathsToConsider) {
            // within one path...
            let pathSlots = this._docs[path];
            let docsThisPath = Object.values(pathSlots);
            // only keep head?
            if (query.isHead) {
                docsThisPath.sort(historySortFn);
                docsThisPath = [docsThisPath[0]];
            }
            // apply the rest of the individual query selectors: path, timestamp, author, contentSize
            // and skip expired ephemeral docs
            docsThisPath
                .filter(d => queryMatchesDoc(query, d) && (d.deleteAfter === null || now <= d.deleteAfter))
                .forEach(d => results.push(d));

            // TODO: optimize this:
            // if sort == 'path' and there's a limit,
            // we could sort pathsToConsider, then if
            // if we finish one path's documents and either of the
            // limits are exceeded, we can bail out of this loop
            // early.  We still have to do the sorting and careful
            // limit checks below, though.
        }

        results.sort(historySortFn);

        // apply limit and limitBytes
        if (query.limit !== undefined) {
            results = results.slice(0, query.limit);
        }

        if (query.limitBytes !== undefined) {
            let bytes = 0;
            for (let ii = 0; ii < results.length; ii++) {
                let doc = results[ii];
                // count content length in bytes in utf-8 encoding, not number of characters
                // TODO: test this works in browsers
                // https://stackoverflow.com/questions/5515869/string-length-in-bytes-in-javascript
                let len = Buffer.byteLength(doc.content, 'utf-8');
                bytes += len;
                // if we hit limitBytes but the next item's content is '',
                // return early (don't include the empty item)
                if (bytes > query.limitBytes || (bytes === query.limitBytes && len === 0)) {
                    results = results.slice(0, ii);
                    break;
                }
            }
        }

        return results;
    }
    paths(query: QueryOpts2, now: number): string[] {
        query = cleanUpQuery(query);

        // TODO: optimization: if the query only cares about path and pathPrefix,
        // we can just filter through Object.keys(_docs)
        // instead of doing a full documentQuery
        // ... but nope, we have to filter out expired docs

        if (query.limit === 0) { return []; }

        // Remove limits.
        // we have to apply the limit to the paths after making them unique,
        // so, first remove limit and do document query.
        // we also remove limitBytes because it has no effect on path queries.
        // (and by the way, documentQuery() also removes expired docs for us.)
        let docs = this.documents({
            ...query,
            limit: undefined,
            limitBytes: undefined
        }, now);

        // get unique paths and sort them
        let pathMap: Record<string, boolean> = {};
        for (let doc of docs) {
            pathMap[doc.path] = true;
        }
        let paths = Object.keys(pathMap);
        paths.sort();

        // re-apply limit
        if (query.limit) {
            paths = paths.slice(0, query.limit);
        }

        // (no need to apply limitBytes since this is a path query)

        return paths;
    }
    contents(query: QueryOpts2, now: number): string[] {
    }
    authors(now: number): AuthorAddress[] {
        let authorMap: Record<string, boolean> = {};
        for (let slots of Object.values(this._docs)) {
            for (let author of Object.keys(slots)) {
                let doc = slots[author];
                if (doc.deleteAfter !== null && doc.deleteAfter < now) { continue; }
                authorMap[author] = true;
            }
        }
        let authors = Object.keys(authorMap);
        authors.sort();
        return authors;
    }
    _upsertDocument(doc: Document): void {
        Object.freeze(doc);
        let slots: Record<string, Document> = this._docs[doc.path] || {};
        slots[doc.author] = doc;
        this._docs[doc.path] = slots;
    }
    removeExpiredDocuments(now: number): void {
        // using "for... in" on purpose since we're deleting while iterating
        for (let path in this._docs) {
            let slots = this._docs[path];
            // delete expired docs from slots
            for (let author in slots) {
                let doc = slots[author];
                if (doc.deleteAfter !== null && doc.deleteAfter < now) {
                    delete slots[author];
                }
            }
            // if slots are empty, remove the entire set of slots
            if (Object.keys(slots).length === 0) {
                delete this._docs[path];
            }
        }
    }
    close(): void {}
    */
}
