import * as fs from 'fs';
import sqlite = require('better-sqlite3');
import {
    Database as SqliteDatabase
} from 'better-sqlite3';

import {
    AuthorAddress,
    Document,
    WorkspaceAddress,
} from '../util/types';
import {
    IStorageDriver,
} from './types2';
import {
    QueryOpts2,
    cleanUpQuery,
} from './query2';
import { logDebug } from '../util/log';

//================================================================================

export class DriverSqlite implements IStorageDriver {
    _workspace: WorkspaceAddress = '';
    _fn: string;
    db: SqliteDatabase = null as any as SqliteDatabase;
    constructor(fn: string) {
        this._fn = fn;
    }
    begin(workspace: WorkspaceAddress): void {
        logDebug(`driverSqlite.begin(workspace: ${workspace})`);
        this._workspace = workspace;

        this.db = sqlite(this._fn);

        this._ensureTables();

        let schemaVersion = this._getConfig('schemaVersion');
        logDebug(`driverSqlite.begin    schemaVersion: ${schemaVersion}`);
        if (schemaVersion === undefined) {
            schemaVersion = '1';
            this._setConfig('schemaVersion', schemaVersion);
        } else if (schemaVersion !== '1') {
            throw new Error(`sqlite file ${this._fn} has unknown schema version ${schemaVersion}`);
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

        this.removeExpiredDocuments(Date.now() * 1000);
    }

    _ensureTables() {
        // for each path and author we can have at most one document

        // TODO: change content to BLOB and make sure it's inserted as an actual BLOB
        // https://sqlite.org/forum/forumpost/4255ad6f19
        // or do length(cast(foo AS BLOB))
        // this is needed to make length return bytes and not unicode codepoints

        this.db.prepare(`
            CREATE TABLE IF NOT EXISTS docs (
                format TEXT NOT NULL,
                workspace TEXT NOT NULL,
                path TEXT NOT NULL,
                contentHash TEXT NOT NULL,
                content TEXT NOT NULL, -- TODO: allow null, change to BLOB
                author TEXT NOT NULL,
                timestamp NUMBER NOT NULL,
                deleteAfter NUMBER,  -- can be null
                signature TEXT NOT NULL,
                PRIMARY KEY(path, author)
            );
        `).run();
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

    _setConfig(key: string, content: string): void {
        this.db.prepare(`
            INSERT OR REPLACE INTO config (key, content) VALUES (:key, :content);
        `).run({ key: key, content: content });
    }
    _getConfig(key: string): string | undefined {
        let result = this.db.prepare(`
            SELECT content FROM config WHERE key = :key;
        `).get({ key: key });
        return (result === undefined) ? undefined : result.content;
    }
    _deleteConfig(key: string): void {
        this.db.prepare(`
            DELETE FROM config WHERE key = :key;
        `).run({ key: key });
    }
    _deleteAllConfig(): void {
        this.db.prepare(`
            DELETE FROM config;
        `).run();
    }

    authors(now: number): AuthorAddress[] {
        logDebug('driverSqlite.authors(now)');
        let docs: Document[] = this.db.prepare(`
            SELECT DISTINCT author FROM docs
            -- permanent docs, or ephemeral docs that are not expired yet
            WHERE deleteAfter IS NULL OR :now <= deleteAfter
            ORDER BY author;
        `).all({ now });
        return docs.map(doc => doc.author);
    }
    _makeDocQuerySql(query: QueryOpts2, now: number, mode: 'documents' | 'paths'):
        { sql: string, params: Record<string, any> }
        {

        let sql = '';

        let select = '';

        let wheres: string[] = [];
        let params: Record<string, any> = {};

        if (mode === 'documents') {
            select = 'SELECT * FROM docs';
        } else if (mode === 'paths') {
            select = 'SELECT DISTINCT path FROM docs';
        }

        // use the query
        if (query.path !== undefined) {
            wheres.push('path = :path');
            params.path = query.path;
        }
        if (query.pathPrefix !== undefined) {
            // escape existing % and _ in the prefix
            // so they don't count as wildcards for LIKE
            wheres.push("path LIKE (:prefix || '%') ESCAPE '\\'");
            params.prefix = query.pathPrefix
                .split('_').join('\\_')
                .split('%').join('\\%');
        }
        if (query.timestamp !== undefined) {
            wheres.push('timestamp = :timestamp');
            params.timestamp = query.timestamp;
        }
        if (query.timestamp_gt !== undefined) {
            wheres.push('timestamp > :timestamp_gt');
            params.timestamp_gt = query.timestamp_gt;
        }
        if (query.timestamp_lt !== undefined) {
            wheres.push('timestamp < :timestamp_lt');
            params.timestamp_lt = query.timestamp_lt;
        }
        if (query.author !== undefined) {
            wheres.push('author = :author');
            params.author = query.author;
        }
        // TODO: when content can be null, make sure to skip null-content docs here.
        // (though we could check if contentHash is the known has of an empty string)
        // Sqlite length() returns characters, not bytes, for TEXT.
        // To get bytes the data must be stored as BLOB.
        // TODO: store content as BLOB.
        if (query.contentSize !== undefined) {
            wheres.push('length(content) = :contentSize');
            params.contentSize = query.contentSize;
        }
        if (query.contentSize_gt !== undefined) {
            wheres.push('length(content) > :contentSize_gt');
            params.contentSize_gt = query.contentSize_gt;
        }
        if (query.contentSize_lt !== undefined) {
            wheres.push('length(content) < :contentSize_lt');
            params.contentSize_lt = query.contentSize_lt;
        }

        // TODO: isHead

        let limit = '';
        if (query.limit !== undefined) {
            limit = 'LIMIT :limit';
            params.limit = query.limit;
        }

        // limitBytes is skipped here.
        // it's applied after the query is run,
        // and only for docs (not paths).

        // filter out expired docs
        wheres.push('(deleteAfter IS NULL OR :now <= deleteAfter)');
        params.now = now;

        // assemble the final sql
        let allWheres = wheres.length === 0
            ? ''
            : 'WHERE ' + wheres.join('\n  AND ');
        sql = `
            ${select}
            ${allWheres}
            ORDER BY path ASC, timestamp DESC, signature DESC -- break ties with signature
            ${limit};
        `;

        /*
        a regular query looks like:
            SELECT format, workspace, ... timestamp FROM docs
            WHERE path, pathPrefix, timestamp, author, contentSize
            ORDER BY
            LIMIT

        if we just did "GROUP BY path" to the above query, after WHERE,
        we'd get "the latest of the matches in each path", not true heads.

        an isHead query needs to look like this, to only get
        actual heads and not just "the latest of the matches in each path":

            SELECT format, workspace, ... MAX(timestamp) as timestamp FROM docs
            -- first level of filtering happens before finding the head
            -- these are only things that are the same for all docs in a path
            WHERE path, pathPrefix
            GROUP BY path
            -- second level of filtering happens AFTER finding the head
            -- these are things that can differ for docs within a path
            HAVING timestamp, author, contentSize
            ORDER BY
            LIMIT
        */

        return { sql, params };
    }
    paths(query: QueryOpts2, now: number): string[] {
        query = cleanUpQuery(query);
        if (query.limit === 0) { return []; }

        let { sql, params } = this._makeDocQuerySql(query, now, 'paths');
        logDebug('driverSqlite.pathQuery(query, now)');
        logDebug('  query:', query);
        logDebug('  sql:', sql);
        logDebug('  params:', params);
        let paths: string[] = this.db.prepare(sql).all(params).map(doc => doc.path);
        logDebug(`  result: ${paths.length} paths`);
        return paths;
    }
    documents(query: QueryOpts2, now: number): Document[] {
        query = cleanUpQuery(query);
        if (query.limit === 0 || query.limitBytes === 0) { return []; }

        let { sql, params } = this._makeDocQuerySql(query, now, 'documents');
        logDebug('driverSqlite.documentQuery(query, now)');
        logDebug('  query:', query);
        logDebug('  sql:', sql);
        logDebug('  params:', params);
        let docs: Document[] = this.db.prepare(sql).all(params);

        // TODO: count byte length of utf-8, not character length
        if (query.limitBytes !== undefined) {
            let bytes = 0;
            for (let ii = 0; ii < docs.length; ii++) {
                let doc = docs[ii];
                // count content length in bytes in utf-8 encoding, not number of characters
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
    _upsertDocument(doc: Document): void {
        // Insert new doc, replacing old doc if there is one
        Object.freeze(doc);
        logDebug(`driverSqlite.upsertDocument(doc.path: ${JSON.stringify(doc.path)})`);
        this.db.prepare(`
            INSERT OR REPLACE INTO docs (format, workspace, path, contentHash, content, author, timestamp, deleteAfter, signature)
            VALUES (:format, :workspace, :path, :contentHash, :content, :author, :timestamp, :deleteAfter, :signature);
        `).run(doc);
    }
    removeExpiredDocuments(now: number): void {
        logDebug('driverSqlite.removeExpiredDocuments(now)');
        this.db.prepare(`
            DELETE FROM docs
            WHERE deleteAfter NOT NULL AND deleteAfter < :now;
        `).run({ now });
    }
    close(): void {
        this.db.close();
    }
}
