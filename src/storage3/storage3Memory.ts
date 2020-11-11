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
    Query3ForForget,
    documentIsExpired,
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

            // apply the rest of the individual query selectors: path, timestamp, author, contentLength
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

    _filterDocs(shouldKeep: (doc: Document) => boolean): void {
        this._assertNotClosed();
        let now = this._now || (Date.now() * 1000);
        // using "for... in" on purpose since we're deleting while iterating
        for (let path in this._docs) {
            let slots = this._docs[path];
            // delete expired docs from slots
            for (let author in slots) {
                let doc = slots[author];
                if (!shouldKeep(doc)) {
                    delete slots[author];
                }
            }
            // if slots are empty, remove the entire set of slots
            if (Object.keys(slots).length === 0) {
                delete this._docs[path];
            }
        }
    }

    forgetDocuments(query: Query3ForForget): void {
        query = cleanUpQuery(query) as Query3ForForget;
        this._filterDocs((doc) => !queryMatchesDoc(query, doc));
    }

    discardExpiredDocuments(): void {
        this._assertNotClosed();
        let now = this._now || (Date.now() * 1000);
        this._filterDocs((doc) => !documentIsExpired(doc, now));
    }

    destroyAndClose(): void {
        this._assertNotClosed();
        this._docs = {};
        this._config = {};
        this.close();
    }
}
