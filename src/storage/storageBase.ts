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
    WriteResult,
    isErr
} from '../util/types';
import {
    IStorage,
    WriteEvent,
} from './storageTypes';
import { Query, QueryForForget, QueryNoLimitBytes } from './query';
import { Emitter } from '../util/emitter';
import { uniq, sorted } from '../util/helpers';
import { sha256base32 } from '../crypto/crypto';
import { cleanUpQuery } from './query';
import Logger from '../util/log';

let logger = new Logger('StorageBase');

export abstract class StorageBase implements IStorage {
    workspace : WorkspaceAddress;
    readonly sessionId: string;
    _now: number | null = null;
    onWrite: Emitter<WriteEvent>;
    onWillClose: Emitter<undefined>;
    onDidClose: Emitter<undefined>;

    _isClosed: boolean = false;
    _validatorMap: {[format: string]: IValidator};
    _discardInterval: any | null = null;

    constructor(validators: IValidator[], workspace: WorkspaceAddress) {

        // when subclassing this class, you will need to call
        //    super(validators, workspace)
        // as the first line in your own constructor.
        //
        // if you don't know the workspace yet, you can give it a fake one
        // and then set this.workspace later in the constructor.
        // if you do that, make sure to validate the workspace yourself
        // (copy the section "check if the workspace is valid to at least one validator"
        // into your constructor).
        //
        // if you need to throw an exception from your constructor,
        // you have to call this.close() first to stop the hourly discard thread,
        // or node will hang instead of exiting because that timer will still be waiting.

        logger.log('constructor for workspace ' + workspace);        

        this.workspace = workspace;
        this.sessionId = '' + Math.random();

        this.onWrite = new Emitter<WriteEvent>();
        this.onWillClose = new Emitter<undefined>();
        this.onDidClose = new Emitter<undefined>();

        if (validators.length === 0) {
            throw new ValidationError('must provide at least one validator to Storage');
        }
        // make lookup table from format to validator class
        this._validatorMap = {};
        for (let validator of validators) {
            this._validatorMap[validator.format] = validator;
        }

        // check if the workspace is valid to at least one validator
        let workspaceErrs = validators.map(val => val._checkWorkspaceIsValid(workspace)).filter(err => err !== true);
        if (workspaceErrs.length === validators.length) {
            // every validator had an error
            // let's throw... the first one I guess
            throw workspaceErrs[0];
        }
        // ok, at least one validator accepted the workspace address

        //----------------------------------------
        // remove expired documents

        // remove them at startup.
        // wait a little while before doing this
        // in case the user wants to change this._now just after instantiation.
        setTimeout(() => {
            if (!this.isClosed()) {
                this.discardExpiredDocuments();
            }
        }, 500);

        // also discard expired documents once an hour
        // this thread will be stopped in close()
        this._discardInterval = setInterval(() => {
            if (!this.isClosed()) {
                this.discardExpiredDocuments()
            } else {
                clearInterval(this._discardInterval);
                this._discardInterval = null;
            }
        }, 60 * 60 * 1000);
    }

    _assertNotClosed(): void {
        if (this._isClosed) { throw new StorageIsClosedError(); }
    }

    abstract setConfig(key: string, content: string): void;
    abstract getConfig(key: string): string | undefined;
    abstract deleteConfig(key: string): void;
    abstract deleteAllConfig(): void;

    // TODO
    // config get/set
    // assert not closed
    // remove expired docs
    // close and remove all

    // GET DATA OUT
    abstract documents(query?: Query): Document[];
    contents(query?: Query): string[] {
        this._assertNotClosed();
        return this.documents(query).map(doc => doc.content);
    }
    authors(): AuthorAddress[] {
        // return all authors, even ones that only occur back in the history
        this._assertNotClosed();
        return sorted(uniq(this.documents({ history: 'all' }).map(doc => doc.author)));
    }
    paths(q?: QueryNoLimitBytes): string[] {
        this._assertNotClosed();
        let query = cleanUpQuery(q || {});

        // if limit is zero, this will always return []
        if (query.limit === 0) { return []; }

        // to make sure we're counting unique paths, not documents, we have to:
        // remove limit
        let queryNoLimit = { ...query, limit: undefined, limitBytes: undefined };
        // do query and get unique paths
        let docs = this.documents(queryNoLimit)
        let paths = sorted(uniq(docs.map(doc => doc.path)));
        // re-apply limit
        if (query.limit !== undefined) {
            paths = paths.slice(0, query.limit);
        }
        return paths;
    }

    getDocument(path: string): Document | undefined {
        this._assertNotClosed();
        return this.documents({ path: path, limit: 1, history: 'latest' })[0];
    }
    getContent(path: string): string | undefined {
        this._assertNotClosed();
        return this.getDocument(path)?.content;
    }

    // PUT DATA IN
    abstract _upsertDocument(doc: Document): void;
    ingestDocument(doc: Document, fromSessionId: string): WriteResult | ValidationError {
        this._assertNotClosed();

        let now = this._now || (Date.now() * 1000);

        // validate doc
        let validator = this._validatorMap[doc.format];
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

        // get existing doc from same author, same path, to decide if the incoming one is newer
        let existingSameAuthor : Document | undefined = this.documents({
            path: doc.path,
            author: doc.author,
            history: 'all',
        })[0];

        // there might be an existingSameAuthor that's ephemeral and has expired.
        // if so, it will not have been returned from this.documents().
        // we'll just overwrite it with upsertDocument() as if it wasn't there.

        // Compare timestamps.
        // Compare signature to break timestamp ties.
        // Note this is based only on timestamp and does not care about deleteAfter
        // (e.g. the lifespan of ephemeral documents doesn't matter when comparing them)
        // TODO: can't compare arrays like this, use an array comparison function
        if (existingSameAuthor !== undefined
            && [doc.timestamp, doc.signature]
            <= [existingSameAuthor.timestamp, existingSameAuthor.signature]
            ) {
            // incoming doc is older or identical.  ignore it.
            return WriteResult.Ignored;
        }

        // upsert, replacing old doc if there is one
        this._upsertDocument(doc);

        // read it again to see if it's the new latest doc
        let latestDoc = this.getDocument(doc.path);
        let isLatest = deepEqual(doc, latestDoc);

        // END LOCK

        // Send events.
        this.onWrite.send({
            kind: 'DOCUMENT_WRITE',
            document: doc,
            fromSessionId: fromSessionId,
            isLocal: fromSessionId === this.sessionId,
            isLatest: isLatest,
        });

        return WriteResult.Accepted;
    }
    set(keypair: AuthorKeypair, docToSet: DocToSet): WriteResult | ValidationError {
        this._assertNotClosed();

        let now = this._now || (Date.now() * 1000);

        let validator = this._validatorMap[docToSet.format];
        if (validator === undefined) {
            return new ValidationError(`set: unrecognized format ${docToSet.format}`);
        }

        let shouldBumpTimestamp = false;
        if (docToSet.timestamp === 0 || docToSet.timestamp === undefined) {
            // When timestamp is not provided, default to now
            // and bump if necessary.
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
        };

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

            let existingDocTimestamp = this.getDocument(doc.path)?.timestamp || 0;
            doc.timestamp = Math.max(doc.timestamp, existingDocTimestamp+1);

            if (lifespan !== null) {
                // Make the doc live the same duration it was originally supposed to live
                doc.deleteAfter = doc.timestamp + lifespan;
            }
        }

        // sign and ingest the doc
        let signedDoc = validator.signDocument(keypair, doc);
        if (isErr(signedDoc)) { return signedDoc; }
        let result = this.ingestDocument(signedDoc, this.sessionId);

        // END LOCK
        return result;
    }

    abstract forgetDocuments(query: QueryForForget): void;
    abstract discardExpiredDocuments(): void;

    // CLOSE
    isClosed(): boolean { return this._isClosed; }

    abstract _close(opts: { delete: boolean }): void;

    close(opts?: { delete: boolean }) {
        logger.log(`🚫 CLOSE ${this.workspace} 🚫`);

        if (this._isClosed) {
            logger.log('🚫 ...already closed; returning.');
            return;
        }
        logger.log('🚫 ...sending onWillClose');
        this.onWillClose.send(undefined);

        this._isClosed = true;

        logger.log('🚫 ...stopping ephemeral deletion thread');
        // stop the hourly discard thread
        if (this._discardInterval !== null) {
            clearInterval(this._discardInterval);
            this._discardInterval = null;
        }

        logger.log('🚫 ...calling subclass _close()');
        if (opts?.delete === true) {
            logger.log('🚫 ...and will delete.');
        }
        this._close(opts || { delete: false });

        logger.log('🚫 ...sending onDidClose');
        this.onDidClose.send(undefined);
        logger.log('🚫 done.');
    }
}
