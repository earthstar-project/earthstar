import fs = require('fs');
import sqlite = require('better-sqlite3');
import {
    Database as SqliteDatabase
} from 'better-sqlite3';

import {
    AuthorAddress,
    Document,
    IValidator,
    ValidationError,
    WorkspaceAddress,
} from '../util/types';

import {
    Query3,
    Query3ForForget,
    cleanUpQuery,
} from './query3';
import {
    Storage3Base,
} from './storage3Base';

import { logDebug } from '../util/log';

//================================================================================

export class Storage3Sqlite extends Storage3Base {

    _fn: string;
    db: SqliteDatabase = null as any as SqliteDatabase;

    constructor(validators: IValidator[], workspace: WorkspaceAddress, fn: string) {
        super(validators, workspace);

        logDebug(`sqlite.constructor(workspace: ${workspace})`);

        this._fn = fn;
        this.db = sqlite(this._fn);

        this._ensureTables();

        let schemaVersion = this.getConfig('schemaVersion');
        logDebug(`sqlite\.constructor    schemaVersion: ${schemaVersion}`);
        /* istanbul ignore else */
        if (schemaVersion === undefined) {
            schemaVersion = '1';
            this.setConfig('schemaVersion', schemaVersion);
        } else if (schemaVersion !== '1') {
            throw new ValidationError(`sqlite file ${this._fn} has unknown schema version ${schemaVersion}`);
        }

        // TODO: check if workspace matches existing data in the file
        // TODO: creation modes:
        //   mode: create
        //   workspace: required
        //   file must not exist yet
        //
        //   mode: open
        //   workspace: optional
        //   file must exist
        //
        //   mode: create-or-open  (ensure it exists, create if necessary)
        //   workspace: required
        //   file may or may not exist

        // remove expired documents.
        // wait a moment before doing this, in case the user
        // wants to change this._now just after instantiation.
        setTimeout(() => {
            let now = this._now || (Date.now() * 1000);
            if (!this.isClosed()) {
                this.discardExpiredDocuments();
            }
        }, 100);
    }

    _ensureTables() {
        // for each path and author we can have at most one document

        // TODO: how to tell if we're loading an old sqlite file with old schema?

        this._assertNotClosed();

        // make sure sqlite is using utf-8
        let encoding = this.db.pragma('encoding', { simple: true });
        /* istanbul ignore next */
        if (encoding !== 'UTF-8') {
            throw new Error(`sqlite encoding is stubbornly set to ${encoding} instead of UTF-8`);
        }

        this.db.prepare(`
            CREATE TABLE IF NOT EXISTS docs (
                format TEXT NOT NULL,
                workspace TEXT NOT NULL,
                path TEXT NOT NULL,
                contentHash TEXT NOT NULL,
                content TEXT NOT NULL, -- TODO: convert to BLOB?
                author TEXT NOT NULL,
                timestamp NUMBER NOT NULL,
                deleteAfter NUMBER,  -- can be null
                signature TEXT NOT NULL,
                PRIMARY KEY(path, author)
            );
        `).run();
        // // TODO: which of these indexes do we really need?
        // this.db.prepare(`CREATE INDEX IF NOT EXISTS idx1 ON docs(path, author);`).run();
        // this.db.prepare(`CREATE INDEX IF NOT EXISTS idx2 ON docs(path, timestamp);`).run();
        // this.db.prepare(`CREATE INDEX IF NOT EXISTS idx3 ON docs(timestamp);`).run();
        // this.db.prepare(`CREATE INDEX IF NOT EXISTS idx4 ON docs(author);`).run();

        // the config table is used to store these variables:
        //     workspace - the workspace this store was created for
        //     schemaVersion
        this.db.prepare(`
            CREATE TABLE IF NOT EXISTS config (
                key TEXT NOT NULL PRIMARY KEY,
                content TEXT NOT NULL
            );
        `).run();
    }

    setConfig(key: string, content: string): void {
        logDebug(`sqlite.setConfig(${JSON.stringify(key)} = ${JSON.stringify(content)})`);
        this._assertNotClosed();
        this.db.prepare(`
            INSERT OR REPLACE INTO config (key, content) VALUES (:key, :content);
        `).run({ key: key, content: content });
    }
    getConfig(key: string): string | undefined {
        this._assertNotClosed();
        let row = this.db.prepare(`
            SELECT content FROM config WHERE key = :key;
        `).get({ key: key });
        let result = (row === undefined) ? undefined : row.content;
        logDebug(`sqlite.getConfig(${JSON.stringify(key)}) = ${JSON.stringify(result)}`);
        return result;
    }
    deleteConfig(key: string): void {
        logDebug(`sqlite.deleteConfig(${JSON.stringify(key)})`);
        this._assertNotClosed();
        this.db.prepare(`
            DELETE FROM config WHERE key = :key;
        `).run({ key: key });
    }
    deleteAllConfig(): void {
        logDebug(`sqlite.deleteAllConfig()`);
        this._assertNotClosed();
        this.db.prepare(`
            DELETE FROM config;
        `).run();
    }

    _makeDocQuerySql(query: Query3, now: number, mode: 'documents' | 'delete'):
        { sql: string, params: Record<string, any> }
        {
        /**
         * Internal function to make SQL to query for documents or paths,
         * or delete documents matching a query.
         * 
         * Assumes query has already been through cleanUpQuery(q).
         * 
         * If query.history === 'all', we can do an easy query:
         * 
         * ```
         *     SELECT * from DOCS
         *     WHERE path = "/abc"
         *         AND timestamp > 123
         *     ORDER BY path ASC, author ASC
         *     LIMIT 123
         * ```               
         * 
         * If query.history === 'latest', we have to do something more complicated.
         * We don't want to filter out some docs, and THEN get the latest REMAINING
         * docs in each path.
         * We want to first get the latest doc per path, THEN filter those.
         * 
         * ```
         *     SELECT *, MAX(timestamp) from DOCS
         *     -- first level of filtering happens before we choose the latest doc.
         *     -- here we can only do things that are the same for all docs in a path.
         *     WHERE path = "/abc"
         *     -- now group by path and keep the newest one
         *     GROUP BY path
         *     -- finally, second level of filtering happens AFTER we choose the latest doc.
         *     -- these are things that can differ for docs within a path
         *     HAVING timestamp > 123
         *     ORDER BY path ASC, author ASC
         *     LIMIT 123
         * ```
        */

        let select = '';
        let from = 'FROM docs';
        let wheres: string[] = [];
        let groupBy = '';
        let havings: string[] = [];
        let orderBy = mode === 'delete' ? '' : 'ORDER BY path ASC, author ASC';
        let limit = '';

        let params: Record<string, any> = {};
        let sql = '';

        if (mode === 'documents') {
            if (query.history === 'all') {
                select = 'SELECT *';
            } else if (query.history === 'latest') {
                // We're going to GROUP BY path and want to get the doc with the highest timestamp.
                // To break timestamp ties, we'll use the signature.
                // Because we need to look at multiple columns to choose the winner of the group
                // we can't just do MAX(timestamp), we have to do this silly thing instead:
                // TODO: test sorting by signature when timestamp is tied
                select = 'SELECT *, MIN(CAST(9999999999999999 - timestamp AS TEXT) || signature) AS toSortWithinPath';
                //select = 'SELECT *, MAX(timestamp) AS toSortWithinPath';
                groupBy = 'GROUP BY path';
            } else {
                /* istanbul ignore next */
                throw new ValidationError(`unexpected query.history = ${query.history}`);
            }
        } else if (mode === 'delete') {
            if (query.history === 'all') {
                select = 'DELETE';
            } else {
                /* istanbul ignore next */
                throw new ValidationError(`query.history must be "all" when doing forgetDocuments`);
            }
        } else {
            // if (mode === 'paths') {
            /* istanbul ignore next */
            throw new Error('unknown mode to _makeDocQuerySql: ' + mode);
            //select = 'SELECT DISTINCT path';
        }

        // parts of the query that are the same for all docs in a path can go in WHERE.
        if (query.path !== undefined) {
            wheres.push('path = :path');
            params.path = query.path;
        }
        if (query.pathPrefix !== undefined) {
            // Escape existing % and _ in the prefix so they don't count as wildcards for LIKE.
            // TODO: test this
            wheres.push("path LIKE (:prefix || '%') ESCAPE '\\'");
            params.prefix = query.pathPrefix
                .split('_').join('\\_')
                .split('%').join('\\%');
        }

        // parts of the query that differ across docs in the same path
        // may have to go in HAVING if we're doing a GROUP BY.
        if (query.timestamp !== undefined) {
            havings.push('timestamp = :timestamp');
            params.timestamp = query.timestamp;
        }
        if (query.timestamp_gt !== undefined) {
            havings.push('timestamp > :timestamp_gt');
            params.timestamp_gt = query.timestamp_gt;
        }
        if (query.timestamp_lt !== undefined) {
            havings.push('timestamp < :timestamp_lt');
            params.timestamp_lt = query.timestamp_lt;
        }
        if (query.author !== undefined) {
            havings.push('author = :author');
            params.author = query.author;
        }
        // Sqlite length() counts unicode characters for TEXT and bytes for BLOB.
        // We can convert TEXT to BLOB on the fly like: length(CAST(content AS BLOB)).
        // Or we could store content as BLOB in the first place, which also involves
        // converting it to a javascript Buffer before handing it to sqlite, and back.
        // Need to benchmark this on large blobs.
        // https://sqlite.org/forum/forumpost/4255ad6f19
        if (query.contentLength !== undefined) {
            havings.push('length(CAST(content AS BLOB)) = :contentLength');
            params.contentLength = query.contentLength;
        }
        if (query.contentLength_gt !== undefined) {
            havings.push('length(CAST(content AS BLOB)) > :contentLength_gt');
            params.contentLength_gt = query.contentLength_gt;
        }
        if (query.contentLength_lt !== undefined) {
            havings.push('length(CAST(content AS BLOB)) < :contentLength_lt');
            params.contentLength_lt = query.contentLength_lt;
        }

        if (query.continueAfter !== undefined) {
            havings.push('(path > :continuePath OR (path = :continuePath AND author > :continueAuthor))');
            params.continuePath = query.continueAfter.path;
            params.continueAuthor = query.continueAfter.author;
        }

        if (query.limit !== undefined && mode !== 'delete') {
            limit = 'LIMIT :limit';
            params.limit = query.limit;
        }

        // limitBytes is skipped here since it can't be expressed in SQL.
        // it's applied after the query is run, and only for docs (not paths).

        // filter out expired docs.
        // to pretend they don't exist at all, we use WHERE instead of HAVING.
        // otherwise they might end up as a latest doc of a group,
        // and then disqualify that group.
        wheres.push('(deleteAfter IS NULL OR :now <= deleteAfter)');
        params.now = now;

        // assemble the final sql

        // in 'all' mode, we don't need to use HAVING, we can do all the filters as WHERE.
        if (query.history === 'all') {
            wheres = wheres.concat(havings);
            havings = [];
        }

        let allWheres = wheres.length === 0
            ? ''
            : 'WHERE ' + wheres.join('\n  AND ');
        let allHavings = havings.length === 0
            ? ''
            : 'HAVING ' + havings.join('\n  AND ');

        sql = `
            ${select}
            ${from}
            ${allWheres}
            ${groupBy}
            ${allHavings}
            ${orderBy}
            ${limit};
        `;
        return { sql, params };
    }

    documents(q?: Query3): Document[] {
        this._assertNotClosed();
        let query = cleanUpQuery(q || {});
        if (query.limit === 0 || query.limitBytes === 0) { return []; }
        let now = this._now || (Date.now() * 1000);

        logDebug('sqlite\.documents(query)');
        logDebug('  query:', query);

        let { sql, params } = this._makeDocQuerySql(query, now, 'documents');
        logDebug('  sql:', sql);
        logDebug('  params:', params);

        let docs: Document[] = this.db.prepare(sql).all(params);
        if (query.history === 'latest') {
            // remove extra field we added to find the winner within each path
            docs.forEach(d => { delete (d as any).toSortWithinPath; });
        }

        // TODO: count byte length of utf-8, not character length
        if (query.limitBytes !== undefined) {
            let bytes = 0;
            for (let ii = 0; ii < docs.length; ii++) {
                let doc = docs[ii];
                // count content length in bytes in utf-8 encoding, not number of characters
                // TODO: test this works in browsers
                // https://stackoverflow.com/questions/5515869/string-length-in-bytes-in-javascript
                let len = Buffer.byteLength(doc.content, 'utf-8');
                bytes += len;
                // if we hit limitBytes but the next item's content is '',
                // return early (don't include the empty item)
                if (bytes > query.limitBytes || (bytes === query.limitBytes && len === 0)) {
                    docs = docs.slice(0, ii);
                    break;
                }
            }
        }

        docs.forEach(doc => Object.freeze(doc));
        logDebug(`  result: ${docs.length} docs`);
        return docs;
    }

    /*
    // TODO: get this working again for a speedup
    paths(query?: Query3NoLimitBytes): string[] {
        query = cleanUpQuery(query);
        if (query.limit === 0) { return []; }

        let { sql, params } = this._makeDocQuerySql(query, now, 'paths');
        logDebug('sqlite\.pathQuery(query, now)');
        logDebug('  query:', query);
        logDebug('  sql:', sql);
        logDebug('  params:', params);
        let paths: string[] = this.db.prepare(sql).all(params).map(doc => doc.path);
        logDebug(`  result: ${paths.length} paths`);
        return paths;
    }
    */

    authors(): AuthorAddress[] {
        logDebug('sqlite\.authors(now)');
        let now = this._now || (Date.now() * 1000);
        let docs: Document[] = this.db.prepare(`
            SELECT DISTINCT author FROM docs
            -- look at permanent docs and ephemeral docs that are not expired yet
            WHERE deleteAfter IS NULL OR :now <= deleteAfter
            ORDER BY author;
        `).all({ now });
        return docs.map(doc => doc.author);
    }

    _upsertDocument(doc: Document): void {
        // Insert new doc, replacing old doc if there is one
        logDebug(`sqlite\.upsertDocument(doc.path: ${JSON.stringify(doc.path)})`);
        this._assertNotClosed();
        Object.freeze(doc);
        //TODO: convert content from string to Buffer so SQLite will treat it as a BLOB
        //let docWithBuffer = {...doc, content: Buffer.from(doc.content)};
        this.db.prepare(`
            INSERT OR REPLACE INTO docs (format, workspace, path, contentHash, content, author, timestamp, deleteAfter, signature)
            VALUES (:format, :workspace, :path, :contentHash, :content, :author, :timestamp, :deleteAfter, :signature);
        `).run(doc);
    }

    forgetDocuments(q: Query3ForForget): void {
        this._assertNotClosed();
        let query = cleanUpQuery(q);
        if ((query as Query3).limit === 0 || (query as Query3).limitBytes === 0) { return; }
        let now = this._now || (Date.now() * 1000);

        logDebug('sqlite\.forgetDocuments(query)');
        logDebug('  query:', query);

        let { sql, params } = this._makeDocQuerySql(query, now, 'delete');
        logDebug('  sql:', sql);
        logDebug('  params:', params);

        this.db.prepare(sql).run(params);

        // this above query will avoid deleting expired documents, so let's just do that now
        this.discardExpiredDocuments();
    }

    discardExpiredDocuments(): void {
        logDebug('sqlite\.discardExpiredDocuments()');
        this._assertNotClosed();
        let now = this._now || (Date.now() * 1000);
        this.db.prepare(`
            DELETE FROM docs
            WHERE deleteAfter NOT NULL AND deleteAfter < :now;
        `).run({ now });
    }

    close(): void {
        logDebug('sqlite\.close()');
        this._isClosed = true;
        this.db.close();
    }

    destroyAndClose(): void {
        logDebug('sqlite\.destroyAndClose()');
        this._assertNotClosed();
        if (this._fn !== ':memory:') {
            // delete the sqlite file
            if (fs.existsSync(this._fn)) {
                fs.unlinkSync(this._fn);
            }
        }
        this.close();
    }
}
