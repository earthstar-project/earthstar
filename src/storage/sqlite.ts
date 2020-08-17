import * as fs from 'fs';
import sqlite = require('better-sqlite3');
import {
    Database as SqliteDatabase
} from 'better-sqlite3';
import {
    AuthorAddress,
    AuthorKeypair,
    DocToSet,
    Document,
    IStorage,
    IValidator,
    QueryOpts,
    StorageIsClosedError,
    SyncOpts,
    SyncResults,
    ValidationError,
    WorkspaceAddress,
    WriteResult,
    isErr,
} from '../util/types';
import { Emitter } from '../util/emitter';
import { logDebug, logWarning } from '../util/log';
import { sha256base32 } from '../crypto/crypto';

export interface StorageSqliteOpts {
    // mode: create
    // workspace: required
    // file must not exist yet
    //
    // mode: open
    // workspace: optional
    // file must exist
    //
    // mode: create-or-open  (ensure it exists, create if necessary)
    // workspace: required
    // file may or may not exist
    //
    mode: 'open' | 'create' | 'create-or-open',
    workspace: WorkspaceAddress | null,
    validators: IValidator[],  // must provide at least one
    filename: string,
}

export class StorageSqlite implements IStorage {
    db : SqliteDatabase;
    workspace : WorkspaceAddress;
    validatorMap : {[format: string] : IValidator};
    onChange : Emitter<undefined>;
    _isClosed : boolean = false;
    constructor(opts : StorageSqliteOpts) {
        this.onChange = new Emitter<undefined>();

        if (opts.validators.length === 0) {
            throw "must provide at least one validator";
        }

        if (opts.workspace) {
            // check if the workspace is valid
            // TODO: try with all the of validators, and only throw an error if they all fail
            let val0 : IValidator = opts.validators[0];
            let workspaceErr = val0._checkWorkspaceIsValid(opts.workspace);
            if (isErr(workspaceErr)) { throw workspaceErr; }
        }

        // in each mode we need to
        // A. check opts for validity
        // B. open/create the sqlite file
        // C. check and/or set the workspace
        if (opts.mode === 'create') {
            // A. check opts for validity
            // file must not exist, workspace must be provided
            if (opts.filename !== ':memory:' && fs.existsSync(opts.filename)) { throw "create mode: file shouldn't already exist but it does: " + opts.filename; }
            if (opts.workspace === null) { throw "create mode: workspace cannot be null"; }

            // B. open/create the sqlite file
            this.db = sqlite(opts.filename);
            this._ensureTables();

            // C. set workspace
            this._setConfig('workspace', opts.workspace);
            this.workspace = opts.workspace

        } else if (opts.mode === 'open') {
            // A. check opts for validity
            // file must exist, workspace is optional
            if (opts.filename === ':memory:') { throw "can't use open mode with ':memory:'" }
            if (!fs.existsSync(opts.filename)) { throw "open mode: file not found: " + opts.filename; }

            // B. open/create the sqlite file
            this.db = sqlite(opts.filename);
            this._ensureTables();

            // C. get existing workspace, and assert the workspace matches
            let existingWorkspace = this._getConfig('workspace');
            if (existingWorkspace === null) {
                /* istanbul ignore next */
                // this should never happen with a valid db file
                throw "open mode: somehow the db file has no existing workspace";
            }
            if (opts.workspace !== null && opts.workspace !== existingWorkspace) {
                throw `open mode: provided workspace ${opts.workspace} doesn't match existing workspace ${existingWorkspace}`;
            }
            this.workspace = existingWorkspace

        } else if (opts.mode === 'create-or-open') {
            // A. check opts for validity
            // file may or may not exist, workspace must be provided
            if (opts.workspace === null) { throw "create-or-open mode: workspace cannot be null"; }

            // B. open/create the sqlite file
            this.db = sqlite(opts.filename);
            this._ensureTables();

            // C. set workspace if needed; assert it matches
            let existingWorkspace = this._getConfig('workspace');
            if (existingWorkspace === null) {
                // we just created a file
                this._setConfig('workspace', opts.workspace);
            } else {
                // we're opening an existing file.  assert it matches
                if (opts.workspace !== existingWorkspace) {
                    throw `create-or-open mode: provided workspace ${opts.workspace} doesn't match existing workspace ${existingWorkspace}`;
                }
            }
            this.workspace = opts.workspace;
        } else {
            throw "unrecognized mode: " + opts.mode;
        }

        this.validatorMap = {};
        for (let validator of opts.validators) {
            this.validatorMap[validator.format] = validator;
        }
    }
    _ensureTables() {
        // later we might decide to allow multiple docs in a path history for a single author,
        // but for now the schema disallows that by having this particular primary key.
        this.db.prepare(`
            CREATE TABLE IF NOT EXISTS docs (
                format TEXT NOT NULL,
                workspace TEXT NOT NULL,
                path TEXT NOT NULL,
                contentHash TEXT NOT NULL,
                content TEXT NOT NULL, -- TODO: allow null
                author TEXT NOT NULL,
                timestamp NUMBER NOT NULL,
                deleteAfter NUMBER,  -- can be null
                signature TEXT NOT NULL,
                PRIMARY KEY(path, author)
            );
        `).run();
        // the config table is used to store these variables:
        //     workspace - the workspace this store was created for
        this.db.prepare(`
            CREATE TABLE IF NOT EXISTS config (
                key TEXT NOT NULL PRIMARY KEY,
                content TEXT NOT NULL
            );
        `).run();
    }
    _setConfig(key : string, content : string) {
        this.db.prepare(`
            INSERT OR REPLACE INTO config (key, content) VALUES (:key, :content);
        `).run({ key: key, content: content });
    }
    _getConfig(key : string) : string | null {
        let result = this.db.prepare(`
            SELECT content FROM config WHERE key = :key
        `).get({ key: key });
        if (result === undefined) { return null; }
        return result.content;
    }

    _removeExpiredDocs(now : number): void {
        this.db.prepare(`
            DELETE FROM docs
            WHERE deleteAfter NOT NULL
            AND :now > deleteAfter;
        `).run({ now: now });
    }

    documents(query? : QueryOpts) : Document[] {
        this._assertNotClosed();

        // TODO: check for and remove expired docs

        if (query === undefined) { query = {}; }
        logDebug(`---- documents(${JSON.stringify(query)})`);

        this._removeExpiredDocs(query.now || Date.now() * 1000);

        // convert the query into an array of SQL clauses
        let filters : string[] = [];
        let filterParams : {[k:string] : any} = {};

        let havings : string[] = [];
        let havingParams : {[k:string] : any} = {};

        // path filters
        if (query.path !== undefined) {
            filters.push('path = :path');
            filterParams.path = query.path;
        }
        if (query.lowPath !== undefined) {
            filters.push(':lowPath <= path');
            filterParams.lowPath = query.lowPath;
        }
        if (query.highPath !== undefined) {
            filters.push('path < :highPath');
            filterParams.highPath = query.highPath;
        }
        if (query.pathPrefix !== undefined) {
            filters.push("path LIKE (:prefix || '%') ESCAPE '\\'");
            // escape existing % and _ in the prefix
            // so they don't count as wildcards for LIKE
            filterParams.prefix = query.pathPrefix
                .split('_').join('\\_')
                .split('%').join('\\%');
        }

        // author filters
        if (query.versionsByAuthor !== undefined) {
            if (query.includeHistory === true) {
                // use a normal WHERE filter
                filters.push("author = :versionsByAuthor")
                filterParams.versionsByAuthor = query.versionsByAuthor;
            } else {
                // desired order:
                //   group by path, only keeping the latest one
                //   only keep the ones matching the given author
                // so we use a HAVING clause to apply it after the GROUP BY.
                havings.push("author = :versionsByAuthor")
                havingParams.versionsByAuthor = query.versionsByAuthor;
            }
        }

        // contentIsEmpty filter
        if (query.contentIsEmpty === true) {
            filters.push("content = ''");
        } else if (query.contentIsEmpty === false) {
            filters.push("content != ''");
        }

        // limit
        let limitClause = '';
        let limitParams : {[k:string] : any} = {};
        if (query.limit !== undefined && query.limit > 0) {
            limitClause = 'LIMIT :limit'
            limitParams.limit = query.limit;
        }

        let combinedFilters = '';
        if (filters.length > 0) {
            combinedFilters = 'WHERE ' + filters.join('\nAND ')
        }

        let queryString = '';
        if (query.includeHistory) {
            // when including history, just get all docs
            queryString = `
                SELECT * FROM docs
                ${combinedFilters}
                ORDER BY path ASC, timestamp DESC, signature DESC  -- break ties with signature
                ${limitClause};
            `;
        } else {
            // when not including history, only get the latest doc per path (from any author)
            logDebug('havings', JSON.stringify(havings));
            let combinedHaving = havings.length === 0 ? '' : 'HAVING ' + havings.join('\nAND ');
            logDebug('combined having', JSON.stringify(combinedHaving));
            queryString = `
                SELECT format, workspace, path, contentHash, content, author, MAX(timestamp) as timestamp, deleteAfter, signature FROM docs
                ${combinedFilters}
                GROUP BY path
                ${combinedHaving}
                ORDER BY path ASC, timestamp DESC, signature DESC  -- break ties with signature
                ${limitClause};
            `;
        }
        logDebug('query', query);
        logDebug('queryString', queryString);
        logDebug('filter params', filterParams);
        logDebug('having params', havingParams);
        logDebug('limit params', limitParams);
        let docs : Document[] = this.db.prepare(queryString).all({...filterParams, ...havingParams, ...limitParams});
        logDebug('result:', docs);
        return docs;
    }
    paths(query? : QueryOpts) : string[] {
        // we have to do the document query with no limit,
        // then remove dupes here, then apply the limit.
        // this is super inefficient on large databases.
        logDebug(`---- paths(${JSON.stringify(query)})`);
        this._assertNotClosed();
        query = query || {};
        let docs = this.documents({...query, limit: undefined});
        // get unique paths up to limit
        let paths : {[p:string] : boolean} = {};
        let ii = 0;
        for (let doc of docs) {
            paths[doc.path] = true;
            ii += 1;
            if (query.limit !== undefined && ii >= query.limit) { break; }
        }
        return Object.keys(paths);
    }
    contents(query? : QueryOpts) : string[] {
        // just search using documents() and extract the contents.
        logDebug(`---- contents(${JSON.stringify(query)})`);
        this._assertNotClosed();
        return this.documents(query).map(doc => doc.content);
    }

    authors(now?: number) : AuthorAddress[] {
        logDebug(`---- authors()`);
        this._assertNotClosed();

        this._removeExpiredDocs(now || Date.now() * 1000);

        let result : any = this.db.prepare(`
            SELECT DISTINCT author FROM docs
            ORDER BY author ASC;
        `).all();
        return result.map((r : any) => r.author);
    }

    getDocument(path : string, now? : number) : Document | undefined {
        // look up the winning document for a single path.
        // return undefined if not found.
        // to get history docs for a path, do docs({path: 'foo', includeHistory: true})
        logDebug(`---- getDocument(${JSON.stringify(path)})`);
        this._assertNotClosed();

        this._removeExpiredDocs(now || Date.now() * 1000);

        let result : any = this.db.prepare(`
            SELECT * FROM docs
            WHERE path = :path 
            ORDER BY timestamp DESC, signature DESC  -- break ties with signature
            LIMIT 1;
        `).get({ path: path });
        logDebug('getDocument result:', result);
        return result;
    }
    getContent(path : string, now? : number) : string | undefined {
        // same as getDocument, but just returns the content, not the whole doc object.
        logDebug(`---- getContent(${JSON.stringify(path)})`);
        this._assertNotClosed();
        return this.getDocument(path, now)?.content;
    }

    ingestDocument(doc : Document, now? : number) : WriteResult | ValidationError {
        // Given a doc from elsewhere, validate, decide if we want it, and possibly store it.
        // Return true if we kept it, false if we rejected it.

        // It can be rejected if it's not the latest one from the same author,
        // or if the doc is invalid (signature, etc).

        // Within a single path we keep the one latest doc from each author.
        // So this overwrites older docs from the same author - they are forgotten.
        // If it's from a new author for this path, we keep it no matter the timestamp.
        // The winning doc is chosen at get time, not write time.

        // now is a timestamp in microseconds, usually omitted but settable for testing purposes.
        logDebug(`---- ingestDocument`);
        logDebug('doc:', doc);
        this._assertNotClosed();

        now = now || Date.now() * 1000;

        let validator = this.validatorMap[doc.format];
        if (validator === undefined) {
            return new ValidationError(`ingestDocument: unrecognized format ${doc.format}`);
        }

        let err = validator.checkDocumentIsValid(doc, now);
        if (isErr(err)) { return err; }

        // Only accept docs from the same workspace.
        if (doc.workspace !== this.workspace) {
            return new ValidationError(`ingestDocument: doc from different workspace`);
        }

        // check if it's newer than existing doc from same author, same path
        let existingSameAuthorSamePath = this.db.prepare(`
            SELECT * FROM docs
            WHERE path = :path
            AND author = :author
            --AND (deleteAfter IS NULL OR :now <= deleteAfter)
            ORDER BY timestamp DESC
            LIMIT 1;
        `).get({ path: doc.path, author: doc.author});

        // check if existing doc is expired
        if (existingSameAuthorSamePath !== undefined) {
            if (existingSameAuthorSamePath.deleteAfter !== null) {
                if (now > existingSameAuthorSamePath.deleteAfter) {
                    // existing doc is expired, so ignore it.
                    // it will get replaced by the new one we're inserting.
                    existingSameAuthorSamePath = undefined;
                }
            }
        }
        
        // Compare timestamps.
        // Compare signature to break timestamp ties.
        if (existingSameAuthorSamePath !== undefined
            && [doc.timestamp, doc.signature]
            <= [existingSameAuthorSamePath.timestamp, existingSameAuthorSamePath.signature]
            ) {
            // incoming doc is older or identical.  ignore it.
            logWarning(`ingestDocument: doc older or identical`);
            return WriteResult.Ignored;
        }

        // Insert new doc, replacing old doc if there is one
        this.db.prepare(`
            INSERT OR REPLACE INTO docs (format, workspace, path, contentHash, content, author, timestamp, deleteAfter, signature)
            VALUES (:format, :workspace, :path, :contentHash, :content, :author, :timestamp, :deleteAfter, :signature);
        `).run(doc);
        this.onChange.send(undefined);
        return WriteResult.Accepted;
    }

    set(keypair : AuthorKeypair, docToSet : DocToSet, now?: number) : WriteResult | ValidationError {
        // Store a document.
        // Timestamp is optional and should normally be omitted or set to 0,
        // in which case it will be set to now().
        // (New writes should always have a timestamp of now() except during
        // unit testing or if you're importing old data.)
        logDebug(`---- set(${JSON.stringify(docToSet.path)}, ${JSON.stringify(docToSet.content)}, ...)`);
        this._assertNotClosed();

        now = now || Date.now() * 1000;

        let validator = this.validatorMap[docToSet.format];
        if (validator === undefined) {
            return new ValidationError(`set: unrecognized format ${docToSet.format}`);
        }

        docToSet.timestamp = docToSet.timestamp || 0;
        let doc : Document = {
            format: docToSet.format,
            workspace: this.workspace,
            path: docToSet.path,
            contentHash: sha256base32(docToSet.content),
            content: docToSet.content,
            author: keypair.address,
            timestamp: docToSet.timestamp || now,
            deleteAfter: docToSet.deleteAfter || null,
            signature: '',
        }

        // If there's an existing doc from anyone,
        // make sure our timestamp is greater
        // even if this puts us slightly into the future.
        // (We know about the existing doc so let's assume we want to supercede it.)
        let existingDocTimestamp = this.getDocument(doc.path, now)?.timestamp || 0;
        doc.timestamp = Math.max(doc.timestamp, existingDocTimestamp+1);

        let signedDoc = validator.signDocument(keypair, doc);
        if (isErr(signedDoc)) { return signedDoc; }
        return this.ingestDocument(signedDoc, now);
    }

    _syncFrom(otherStore : IStorage, existing : boolean, live : boolean) : number {
        // Pull all docs from the other Store and ingest them one by one.
        // TODO: set now, or add an instance variable for overriding now
        logDebug('_syncFrom');
        let numSuccess = 0;
        if (live) {
            // TODO
            throw "live sync not implemented yet";
        }
        if (existing) {
            for (let doc of otherStore.documents({includeHistory: true})) {
                logDebug('_syncFrom: got document from other store.  ingesting...');
                let success = this.ingestDocument(doc);
                logDebug('_syncFrom: ...success = ', success);
                if (success === WriteResult.Accepted) { numSuccess += 1; }
            }
        }
        return numSuccess;
    }

    sync(otherStore : IStorage, opts? : SyncOpts) : SyncResults {
        // Sync with another Store.
        //   opts.direction: 'push', 'pull', or 'both'
        //   opts.existing: Sync existing documents.  Default true.
        //   opts.live (not implemented yet): Continue streaming new changes forever
        // Return the number of docs pushed and pulled.
        // This uses a simple and inefficient algorithm.  Fancier algorithm TBD.

        logDebug('sync');
        this._assertNotClosed();

        // don't sync with yourself
        if (otherStore === this) { return { numPushed: 0, numPulled: 0 }; }

        // don't sync across workspaces
        if (this.workspace !== otherStore.workspace) { return { numPushed: 0, numPulled: 0}; }

        // set default options
        let direction = opts?.direction || 'both';
        let existing = (opts?.existing !== undefined) ? opts?.existing : true;
        let live = (opts?.live !== undefined) ? opts?.live : false;

        let numPushed = 0;
        let numPulled = 0;
        if (direction === 'pull' || direction === 'both') {
            numPulled = this._syncFrom(otherStore, existing, live);
        }
        if (direction === 'push' || direction === 'both') {
            numPushed = otherStore._syncFrom(this, existing, live);
        }
        return { numPushed, numPulled };
    }

    // Close this storage.
    // All functions called after this will throw a StorageIsClosedError,
    // except you can call close() as many times as you want.
    // Once closed, a Storage instance cannot be opened again.
    close() : void {
        this._isClosed = true;
        this.db.close();
    }
    _assertNotClosed() : void {
        if (this._isClosed) { throw new StorageIsClosedError(); }
    }
    // Find out if the storage is closed.
    isClosed() : boolean {
        return this._isClosed;
    }
}
