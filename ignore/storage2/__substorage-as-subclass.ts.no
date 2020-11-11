import { deepEqual } from 'fast-equals';
import {
    AuthorAddress,
    AuthorKeypair,
    DocToSet,
    Document,
    IValidator,
    StorageIsClosedError,
    ValidationError,
    WorkspaceAddress,
    WriteEvent,
    WriteResult,
    isErr,
} from '../util/types';
import { sha256base32 } from '../crypto/crypto';
import { Emitter } from '../util/emitter';
import { ValidatorEs4 } from '../validator/es4';
import { queryMatchesDoc, defaultQuery2, QueryOpts2 } from './query2';

//================================================================================

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

//================================================================================

class MegaStorage {
    workspace : WorkspaceAddress;
    validatorMap : {[format: string] : IValidator};
    onWrite : Emitter<WriteEvent>;
    onChange : Emitter<undefined>;  // deprecated

    _now: number | null = null; // used for testing
    _isClosed: boolean = false;

    constructor(validators: IValidator[], workspace: WorkspaceAddress) {
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
    // GET DATA OUT
    listAuthors(): AuthorAddress[] {
        this._assertNotClosed();
        return this.onListAuthors();
    }
    paths(query: QueryOpts2 = {}): string[] {
        this._assertNotClosed();
        return this.onPathQuery(query);
    }
    documents(query: QueryOpts2 = {}): Document[] {
        this._assertNotClosed();
        return this.onDocumentQuery(query);
    }
    contents(query: QueryOpts2 = {}): string[] {
        this._assertNotClosed();
        return this.onDocumentQuery(query)
            .map(doc => doc.content);
    }
    latestDocument(path: string): Document | undefined {
        this._assertNotClosed();
        let doc = this.onDocumentQuery({ path: path, isHead: true });
        return doc.length === 0 ? undefined : doc[0];
    }
    latestContent(path: string): string | undefined {
        this._assertNotClosed();
        let doc = this.latestDocument(path);
        return doc === undefined ? undefined : doc.content;
    }
    // PUT DATA IN
    ingestDocument(doc: Document, isLocal: boolean): WriteResult | ValidationError {
        this._assertNotClosed();

        let now = this._now || Date.now() * 1000;

        // validate doc
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

        // BEGIN LOCK

        // get existing doc from same author, same path
        let existingSameAuthor : Document | undefined = this.onDocumentQuery({
            path: doc.path,
            author: doc.author,
        })[0];

        // if the existing doc from same author is expired, it should be deleted.
        // but we can just pretend we didn't see it and let it get overwritten by the incoming doc.
        if (existingSameAuthor !== undefined) {
            if (existingSameAuthor.deleteAfter !== null) {
                if (now > existingSameAuthor.deleteAfter) {
                    existingSameAuthor = undefined;
                }
            }
        }

        // Compare timestamps.
        // Compare signature to break timestamp ties.
        if (existingSameAuthor !== undefined
            && [doc.timestamp, doc.signature]
            <= [existingSameAuthor.timestamp, existingSameAuthor.signature]
            ) {
            // incoming doc is older or identical.  ignore it.
            return WriteResult.Ignored;
        }

        // upsert, replacing old doc if there is one
        this.onUpsertDocument(doc);

        // read it again to see if it's the new latest doc
        let latestDoc = this.latestDocument(doc.path);
        let isLatest = deepEqual(doc, latestDoc);

        // END LOCK

        // Send events.
        this.onWrite.send({
            kind: 'DOCUMENT_WRITE',
            isLocal: isLocal === undefined ? false : isLocal,
            isLatest: isLatest,
            document: doc,
        });
        this.onChange.send(undefined);

        return WriteResult.Accepted;
    }
    set(keypair: AuthorKeypair, docToSet: DocToSet): WriteResult | ValidationError {
        this._assertNotClosed();

        let now = this._now || Date.now() * 1000;

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

        // BEGIN LOCK (only needed if shouldBumpTimestamp)
        // this lock recurses into ingestDocument

        // If there's an existing doc from anyone,
        // make sure our timestamp is greater
        // even if this puts us slightly into the future.
        // (We know about the existing doc so let's assume we want to supercede it.)
        // We only do this when the user did not supply a specific timestamp.
        if (shouldBumpTimestamp) {
            // If it's an ephemeral document, remember the length of time the user wanted it to live,
            // so we can adjust the expiration timestamp too
            let lifespan: number | null = doc.deleteAfter === null ? null : (doc.deleteAfter - doc.timestamp);

            let existingDocTimestamp = this.latestDocument(doc.path)?.timestamp || 0;
            doc.timestamp = Math.max(doc.timestamp, existingDocTimestamp+1);

            if (lifespan !== null) {
                // Make the doc live the same duration it was originally supposed to live
                doc.deleteAfter = doc.timestamp + lifespan;
            }
        }

        // sign and ingest the doc
        let signedDoc = validator.signDocument(keypair, doc);
        if (isErr(signedDoc)) { return signedDoc; }
        let result = this.ingestDocument(signedDoc, true);

        // END LOCK
        return result;
    }
    // CLOSE
    close() : void {
        this._isClosed = true;
        this.onClose();
    }
    _assertNotClosed() : void {
        if (this._isClosed) { throw new StorageIsClosedError(); }
    }
    isClosed() : boolean {
        return this._isClosed;
    }
    //================================================================================
    // subclasses should implement these
    onListAuthors(): AuthorAddress[] { return []; }
    onPathQuery(query: QueryOpts2 = {}): string[] { return []; }
    onDocumentQuery(query: QueryOpts2 = {}): Document[] { return []; }
    onUpsertDocument(doc: Document): void {}
    onClose(): void {}
}

//================================================================================

class MegaStorageMemory extends MegaStorage {
    _docs: Record<string, Record<string, Document>> = {};  // path, author --> document
    constructor(validators: IValidator[], workspace: WorkspaceAddress) {
        super(validators, workspace);
    }
    onListAuthors(): AuthorAddress[] {
        let authorMap: Record<string, boolean> = {};
        for (let slots of Object.values(this._docs)) {
            for (let author of Object.keys(slots)) {
                authorMap[author] = true;
            }
        }
        let authors = Object.keys(authorMap);
        authors.sort();
        return authors;
    }
    onPathQuery(query: QueryOpts2 = {}): string[] {
        // query with no limits
        let docs = this.onDocumentQuery({ ...query, limit: undefined, limitBytes: undefined });

        // get unique paths
        let pathMap: Record<string, boolean> = {};
        for (let doc of docs) {
            pathMap[doc.path] = true;
        }
        let paths = Object.keys(pathMap);
        paths.sort();

        // re-apply limits.  ignore limitBytes
        if (query.limit) {
            paths = paths.slice(query.limit);
        }

        return paths;
    }
    onDocumentQuery(query: QueryOpts2 = {}): Document[] {
        // apply defaults to query
        query = { ...defaultQuery2, ...query, }

        if (query.limit === 0 || query.limitBytes === 0) { return []; }

        let results : Document[] = [];

        for (let pathSlots of Object.values(this._docs)) {
            // within one path...
            let docsThisPath = Object.values(pathSlots);
            // only keep head?
            if (query.isHead) {
                docsThisPath.sort(_historySortFn);
                docsThisPath = [docsThisPath[0]];
            }
            // apply the rest of the individual query selectors: path, timestamp, author, contentSize
            docsThisPath = docsThisPath.filter(d => queryMatchesDoc(query, d));
            results = results.concat(docsThisPath);
        }

        results.sort(_historySortFn);

        // apply limit and limitBytes
        if (query.limit) {
            results = results.slice(query.limit);
        }
        if (query.limitBytes) {
            let b = 0;
            for (let ii = 0; ii < results.length; ii++) {
                let doc = results[ii];
                b += doc.content.length;
                if (b > query.limitBytes) {
                    results = results.slice(ii);
                    break;
                }
            }
        }

        return results;
    }
    onUpsertDocument(doc: Document): void {}
    onClose(): void {}
}

//================================================================================

let storage = new MegaStorageMemory([ValidatorEs4], '+gardening.xxxx');

