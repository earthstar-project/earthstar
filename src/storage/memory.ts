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
    WriteEvent,
} from '../util/types';
import { Emitter } from '../util/emitter';
import { sha256base32 } from '../crypto/crypto';

export let _historySortFn = (a: Document, b: Document): number => {
    // When used within one path's documents, puts the winning version first.
    // path ASC (abcd), then timestamp DESC (newest first), then signature DESC (to break timestamp ties)
    if (a.path > b.path) { return 1; }
    if (a.path < b.path) { return -1; }
    if (a.timestamp < b.timestamp) { return 1; }
    if (a.timestamp > b.timestamp) { return -1; }
    if (a.signature < b.signature) { return 1; }
    if (a.signature > b.signature) { return -1; }
    return 0;
};

export class StorageMemory implements IStorage {
    /*
    This uses an in-memory data structure:
    _docs:
    {
        pathA: {
            @author1: {...DOC...},
            @author2: {...DOC...},
        }
        pathB: {
            @author1: {...DOC...},
        }
    }
    _docs[path] is never an empty object, it's always missing or contains docs.

    Each path can have one doc per author.
    Paths with write permissions will only have one author, thus only one doc.
    Public paths can have multiple authors, but one is considered the winner
      (with the highest timestamp).
    */
    _docs : {[path:string] : {[author:string] : Document}} = {};
    workspace : WorkspaceAddress;
    validatorMap : {[format: string] : IValidator};
    onWrite : Emitter<WriteEvent>;
    onChange : Emitter<undefined>;  // deprecated
    _isClosed : boolean = false;
    constructor(validators : IValidator[], workspace : WorkspaceAddress) {
        if (validators.length === 0) {
            throw new Error('must provide at least one validator');
        }

        // check if the workspace is valid
        // TODO: try with all the of validators, and only throw an error if they all fail
        let val0 : IValidator = validators[0];
        let workspaceErr = val0._checkWorkspaceIsValid(workspace);
        if (isErr(workspaceErr)) { throw workspaceErr; }
        this.workspace = workspace;

        this.onWrite = new Emitter<WriteEvent>();
        this.onChange = new Emitter<undefined>();

        this.validatorMap = {};
        for (let validator of validators) {
            this.validatorMap[validator.format] = validator;
        }
    }


    _removeExpiredDocsAtPath(path : string, now: number) : void {
        let authorToDoc = this._docs[path];
        if (authorToDoc === undefined) { return; }
        for (let [author, doc] of Object.entries(authorToDoc)) {
            if (doc.deleteAfter !== null && now > doc.deleteAfter) {
                delete authorToDoc[author];
            }
        }
        if (Object.keys(authorToDoc).length === 0) {
            delete this._docs[path];
        }
    }
    _removeAllExpiredDocs(now: number) : void {
        for (let path of Object.keys(this._docs)) {
            this._removeExpiredDocsAtPath(path, now);
        }
    }

    paths(query? : QueryOpts) : string[] {
        this._assertNotClosed();

        query = query || {};

        // if asking for a single path, check if it exists and return it by itself
        if (query.path !== undefined) {
            if (this._docs[query.path] !== undefined) {
                return [query.path];
            } else {
                return [];
            }
        }
        // don't apply the limit in documents(), do it here
        // after removing duplicates
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
    documents(query? : QueryOpts) : Document[] {
        // return docs that match the query, sorted by path and timestamp

        this._assertNotClosed();

        query = query || {};
        let docs : Document[] = [];

        // if we're only asking for one path, we only need to look at it specifically.
        // otherwise we need to scan the whole dataset.
        let pathsToSearch = query.path !== undefined ? [query.path] : Object.keys(this._docs);

        for (let path of pathsToSearch) {
            // ignore unwanted paths
            if (query.lowPath !== undefined && path < query.lowPath) { continue; }
            if (query.highPath !== undefined && path >= query.highPath) { continue; }
            if (query.pathPrefix !== undefined && !path.startsWith(query.pathPrefix)) { continue; }
            // get all history docs for this path
            let authorToDoc = this._docs[path] || {};
            let pathDocs = Object.values(authorToDoc);
            // is the desired participatingAuthor anywhere in this set of docs?
            // if not, discard it
            if (query.participatingAuthor !== undefined) {
                if (authorToDoc[query.participatingAuthor] === undefined) {
                    continue;
                }
            }
            // sort newest first within this path
            pathDocs.sort(_historySortFn);
            // discard history?
            if (!query.includeHistory) {
                pathDocs = pathDocs.slice(0, 1)
            }
            docs = docs.concat(pathDocs);
        }
        // apply author filters
        if (query.versionsByAuthor !== undefined) {
            docs = docs.filter(doc => doc.author === query?.versionsByAuthor);
        }
        // sort
        docs.sort(_historySortFn);
    
        // remove expired ephemeral docs from our results
        let now = query.now || Date.now() * 1000;
        let originalCount = docs.length;
        docs = docs.filter(doc => doc.deleteAfter === null || doc.deleteAfter >= now);
        if (originalCount !== docs.length) {
            // and if there were any, also trigger a check of the entire database to remove expired docs
            this._removeAllExpiredDocs(now);
        }

        // apply contentIsEmpty filter
        if (query.contentIsEmpty === true) {
            docs = docs.filter(doc => doc.content === "");
        } else if (query.contentIsEmpty === false) {
            docs = docs.filter(doc => doc.content !== "");
        }

        // limit
        if (query.limit) {
            docs = docs.slice(0, query.limit);
        }
        return docs;
    }
    contents(query? : QueryOpts) : string[] {
        // same as docs, but we just return the contents.
        this._assertNotClosed();
        return this.documents(query).map(doc => doc.content);
    }

    authors(now?: number) : AuthorAddress[] {
        this._assertNotClosed();

        // TODO: check for and remove expired docs

        let authorSet : Set<AuthorAddress> = new Set();
        for (let doc of this.documents({ includeHistory: true })) {
            authorSet.add(doc.author);
        }
        let authors = [...authorSet];
        authors.sort();
        return authors;
    }

    getDocument(path : string, now?: number) : Document | undefined {
        // look up the winning document for a single path.
        // return undefined if not found.
        // to get history docs for a path, do documents({path: 'foo', includeHistory: true})

        this._assertNotClosed();

        this._removeExpiredDocsAtPath(path, now || Date.now() * 1000);

        if (this._docs[path] === undefined) { return undefined; }
        let pathHistoryDocs = Object.values(this._docs[path]);
        pathHistoryDocs.sort(_historySortFn);
        return pathHistoryDocs[0];
    }
    getContent(path : string, now?: number) : string | undefined {
        // same as getDocument, but just returns the content, not the whole doc object.
        this._assertNotClosed();
        return this.getDocument(path, now)?.content;
    }

    ingestDocument(doc : Document, now? : number, isLocal? : boolean) : WriteResult | ValidationError {
        // Given a doc from elsewhere, validate, decide if we want it, and possibly store it.
        // Return true if we kept it, false if we rejected it.

        // It can be rejected if it's not the latest one from the same author,
        // or if the doc is invalid (signature, etc).

        // Within a single path we keep the one latest doc from each author.
        // So this overwrites older docs from the same author - they are forgotten.
        // If it's from a new author for this path, we keep it no matter the timestamp.
        // The winning doc is chosen at get time, not write time.

        // now is a timestamp in microseconds, usually omitted but settable for testing purposes.

        this._assertNotClosed();

        now = now || Date.now() * 1000;

        Object.freeze(doc);

        let validator = this.validatorMap[doc.format];
        if (validator === undefined) {
            return new ValidationError(`ingestDocument: unrecognized format ${doc.format}`);
        }

        let err = validator.checkDocumentIsValid(doc, now);
        if (isErr(err)) { return err; }

        // Only accept docs from the same workspace.
        if (doc.workspace !== this.workspace) {
            return new ValidationError(`ingestDocument: can't ingest doc from different workspace`);
        }

        let existingDocsByPath = this._docs[doc.path] || {};
        let existingFromSameAuthor : Document | undefined = existingDocsByPath[doc.author];

        // if the existing doc from same author is expired, it should be deleted.
        // but we can just pretend we didn't see it and let it get overwritten by the incoming doc.
        if (existingFromSameAuthor !== undefined) {
            if (existingFromSameAuthor.deleteAfter !== null) {
                if (now > existingFromSameAuthor.deleteAfter) {
                    existingFromSameAuthor = undefined;
                }
            }
        }

        // Compare timestamps.
        // Compare signature to break timestamp ties.
        if (existingFromSameAuthor !== undefined
            && [doc.timestamp, doc.signature]
            <= [existingFromSameAuthor.timestamp, existingFromSameAuthor.signature]
            ) {
            // incoming doc is older or identical.  ignore it.
            return WriteResult.Ignored;
        }

        // save into our data structure
        existingDocsByPath[doc.author] = doc;
        this._docs[doc.path] = existingDocsByPath;

        // is this newly written document the latest one we have for this path?
        let pathHistoryDocs = Object.values(existingDocsByPath);
        pathHistoryDocs.sort(_historySortFn);
        let isLatest = doc === pathHistoryDocs[0];  // newest docs are first

        // send events
        this.onWrite.send({
            kind: 'DOCUMENT_WRITE',
            isLocal: isLocal === undefined ? false : isLocal,
            isLatest: isLatest,
            document: doc,
        });
        this.onChange.send(undefined);

        return WriteResult.Accepted;
    }

    set(keypair : AuthorKeypair, docToSet : DocToSet, now?: number) : WriteResult | ValidationError {
        // Store a document.
        // docToSet.timestamp is optional and should normally be omitted or set to 0,
        // in which case it will be set to now.
        // now should also normally be omitted; it defaults to Date.now()*1000
        // (New writes should always have a timestamp of now() except during
        // unit testing or if you're importing old data.)

        this._assertNotClosed();

        now = now || Date.now() * 1000;

        let validator = this.validatorMap[docToSet.format];
        if (validator === undefined) {
            return new ValidationError(`set: unrecognized format ${docToSet.format}`);
        }

        let shouldBumpTimestamp = false;
        if (docToSet.timestamp === 0 || docToSet.timestamp === undefined) {
            shouldBumpTimestamp = true;
            docToSet.timestamp = now;
        } else {
            // A manual timestamp was provided.  Don't bump it.
            // Make sure the timestamp (and deleteAfter timestamp) is in the valid range
            let err : true | ValidationError = validator._checkTimestampIsOk(docToSet.timestamp, docToSet.deleteAfter || null, now);
            if (isErr(err)) { return err; }
        }

        let doc : Document = {
            format: docToSet.format,
            workspace: this.workspace,
            path: docToSet.path,
            contentHash: sha256base32(docToSet.content),
            content: docToSet.content,
            author: keypair.address,
            timestamp: docToSet.timestamp,
            deleteAfter: docToSet.deleteAfter || null,
            signature: '',
        }

        // If there's an existing doc from anyone,
        // make sure our timestamp is greater
        // even if this puts us slightly into the future.
        // (We know about the existing doc so let's assume we want to supercede it.)
        // We only do this when the user did not supply a specific timestamp.
        if (shouldBumpTimestamp) {
            // If it's an ephemeral document, remember the length of time the user wanted it to live,
            // so we can adjust the expiration timestamp too
            let lifespan: number | null = doc.deleteAfter === null ? null : (doc.deleteAfter - doc.timestamp);

            let existingDocTimestamp = this.getDocument(doc.path, now)?.timestamp || 0;
            doc.timestamp = Math.max(doc.timestamp, existingDocTimestamp+1);

            if (lifespan !== null) {
                // Make the doc live the same duration it was originally supposed to live
                doc.deleteAfter = doc.timestamp + lifespan;
            }
        }

        let signedDoc = validator.signDocument(keypair, doc);
        if (isErr(signedDoc)) { return signedDoc; }
        return this.ingestDocument(signedDoc, now, true);
    }

    _syncFrom(otherStore : IStorage, existing : boolean, live : boolean) : number {
        // Pull all docs from the other Store and ingest them one by one.

        let numSuccess = 0;
        if (live) {
            // TODO
            throw "live sync not implemented yet";
        }
        if (existing) {
            for (let doc of otherStore.documents({includeHistory: true})) {
                let success = this.ingestDocument(doc);
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
    }
    _assertNotClosed() : void {
        if (this._isClosed) { throw new StorageIsClosedError(); }
    }
    // Find out if the storage is closed.
    isClosed() : boolean {
        return this._isClosed;
    }
}
