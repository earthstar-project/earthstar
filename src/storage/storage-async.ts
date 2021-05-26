import {
    Superbus
} from 'superbus';

import {
    Cmp,
} from './util-types';
import {
    AuthorKeypair,
    Doc,
    DocToSet,
    LocalIndex,
    Path,
    WorkspaceAddress,
} from '../util/doc-types';
import {
    HistoryMode,
    Query,
} from '../query/query-types';
import {
    IStorageAsync,
    IStorageDriverAsync,
    IngestResult,
    IngestResultAndDoc,
    StorageEvent,
    StorageId,
    QueryResult,
} from './storage-types';
import {
    IFormatValidator,
} from '../format-validators/format-validator-types';

import {
    isErr,
    StorageIsClosedError,
    ValidationError,
} from '../util/errors';
import {
    microsecondNow, randomId,
} from '../util/misc';
import {
    compareArrays,
} from './compare';

import { Crypto } from '../crypto/crypto';

//--------------------------------------------------

import { Logger } from '../util/log';
let logger = new Logger('storage async', 'yellowBright');
let loggerSet = new Logger('storage async set', 'yellowBright');
let loggerIngest = new Logger('storage async ingest', 'yellowBright');

//================================================================================

export let docCompareForOverwrite = (newDoc: Doc, oldDoc: Doc): Cmp => {
    // A doc can overwrite another doc if the timestamp is higher, or
    // if the timestamp is tied, if the signature is higher.
    return compareArrays(
        [newDoc.timestamp, newDoc.signature],
        [oldDoc.timestamp, oldDoc.signature],
    );
}

export class StorageAsync implements IStorageAsync {
    storageId: StorageId;
    workspace: WorkspaceAddress;
    formatValidator: IFormatValidator;
    storageDriver: IStorageDriverAsync;
    bus: Superbus<StorageEvent>;

    _isClosed: boolean = false;

    constructor(workspace: WorkspaceAddress, validator: IFormatValidator, driver: IStorageDriverAsync) {
        logger.debug(`constructor.  driver = ${(driver as any)?.constructor?.name}`);
        this.storageId = 'storage-' + randomId();
        this.workspace = workspace;
        this.formatValidator = validator;
        this.storageDriver = driver;
        this.bus = new Superbus<StorageEvent>('|');
    }

    //--------------------------------------------------
    // LIFECYCLE

    isClosed(): boolean {
        return this._isClosed;
    }
    async close(): Promise<void> {
        logger.debug('closing...');
        if (this._isClosed) {
            logger.debug('...already closed.');
            return;
        }
        // TODO: do this all in a lock?
        logger.debug('    sending willClose blockingly...');
        await this.bus.sendAndWait('willClose');
        logger.debug('    marking self as closed...');
        this._isClosed = true;
        logger.debug('    closing storageDriver...');
        await this.storageDriver.close();
        logger.debug('    sending didClose nonblockingly...');
        this.bus.sendLater('didClose');
        logger.debug('...closing done');
    }

    //--------------------------------------------------
    // CONFIG

    async getConfig(key: string): Promise<string | undefined> {
        return await this.storageDriver.getConfig(key);
    }
    async setConfig(key: string, value: string): Promise<void> {
        return await this.storageDriver.setConfig(key, value);
    }
    async listConfigKeys(): Promise<string[]> {
        return await this.storageDriver.listConfigKeys();
    }
    async deleteConfig(key: string): Promise<boolean> {
        return await this.storageDriver.deleteConfig(key);
    }

    //--------------------------------------------------
    // GET

    // one of the few that's synchronous
    getMaxLocalIndex(): number {
        return this.storageDriver.getMaxLocalIndex();
    }

    async getDocsAfterLocalIndex(historyMode: HistoryMode, startAfter: LocalIndex, limit?: number): Promise<Doc[]> {
        logger.debug(`getDocsAfterLocalIndex(${historyMode}, ${startAfter}, ${limit})`);
        if (this._isClosed) { throw new StorageIsClosedError(); }
        let query: Query = {
            historyMode: historyMode,
            orderBy: 'localIndex ASC',
            startAfter: {
                localIndex: startAfter,
            },
            limit,
        };
        return await this.storageDriver.queryDocs(query);
    }

    async getAllDocs(): Promise<Doc[]> {
        logger.debug(`getAllDocs()`);
        if (this._isClosed) { throw new StorageIsClosedError(); }
        return await this.storageDriver.queryDocs({
            historyMode: 'all',
            orderBy: 'path ASC',
        });
    }
    async getLatestDocs(): Promise<Doc[]> {
        logger.debug(`getLatestDocs()`);
        if (this._isClosed) { throw new StorageIsClosedError(); }
        return await this.storageDriver.queryDocs({
            historyMode: 'latest',
            orderBy: 'path ASC',
        });
    }
    async getAllDocsAtPath(path: Path): Promise<Doc[]> {
        logger.debug(`getAllDocsAtPath("${path}")`);
        if (this._isClosed) { throw new StorageIsClosedError(); }
        return await this.storageDriver.queryDocs({
            historyMode: 'all',
            orderBy: 'path ASC',
            filter: { path: path, }
        });
    }
    async getLatestDocAtPath(path: Path): Promise<Doc | undefined> {
        logger.debug(`getLatestDocsAtPath("${path}")`);
        if (this._isClosed) { throw new StorageIsClosedError(); }
        let docs = await this.storageDriver.queryDocs({
            historyMode: 'latest',
            orderBy: 'path ASC',
            filter: { path: path, }
        });
        if (docs.length === 0) { return undefined; }
        return docs[0];
    }

    async queryWithState(query: Query = {}): Promise<QueryResult> {
        logger.debug(`queryWithState`, query);
        return await this.storageDriver.queryWithState(query);
    }

    async queryDocs(query: Query = {}): Promise<Doc[]> {
        logger.debug(`queryDocs`, query);
        return await this.storageDriver.queryDocs(query);
    }

    //queryPaths(query?: Query): Path[];
    //queryAuthors(query?: Query): AuthorAddress[];

    //--------------------------------------------------
    // SET

    async set(keypair: AuthorKeypair, docToSet: DocToSet): Promise<IngestResultAndDoc> {
        loggerSet.debug(`set`, docToSet);
        if (this._isClosed) { throw new StorageIsClosedError(); }

        let protectedCode = async (): Promise<IngestResultAndDoc> => {
            loggerSet.debug('  + set: start of protected region');
            loggerSet.debug('  | deciding timestamp: getting latest doc at the same path (from any author)');
            if (this._isClosed) { throw new StorageIsClosedError(); }

            let timestamp: number;
            if (typeof docToSet.timestamp === 'number') {
                timestamp = docToSet.timestamp;
                loggerSet.debug('  |     docToSet already has a timestamp; not changing it from ', timestamp);
            } else {
                // bump timestamp if needed to win over existing latest doc at same path
                let latestDocSamePath = await this.getLatestDocAtPath(docToSet.path);
                if (latestDocSamePath === undefined) {
                    timestamp = microsecondNow();
                    loggerSet.debug('  |     no existing latest doc, setting timestamp to now() =', timestamp);
                } else {
                    timestamp = Math.max(microsecondNow(), latestDocSamePath.timestamp + 1);
                    loggerSet.debug('  |     existing latest doc found, bumping timestamp to win if needed =', timestamp);
                }
            }

            let doc: Doc = {
                format: 'es.4',
                author: keypair.address,
                content: docToSet.content,
                contentHash: Crypto.sha256base32(docToSet.content),
                deleteAfter: docToSet.deleteAfter ?? null,
                path: docToSet.path,
                timestamp,
                workspace: this.workspace,
                signature: '?',  // signature will be added in just a moment
                // _localIndex will be added during upsert.  it's not needed for the signature.
            }

            loggerSet.debug('  | signing doc');
            let signedDoc = this.formatValidator.signDocument(keypair, doc);
            if (isErr(signedDoc)) {
                return { ingestResult: IngestResult.Invalid, docIngested: null };
            }
            loggerSet.debug('  | signature =', signedDoc.signature);

            loggerSet.debug('  | ingesting...');
            let result: IngestResultAndDoc = await this.ingest(signedDoc, true);  // true means bypass the lock, since we're already in it
            loggerSet.debug('  | ...done ingesting');
            loggerSet.debug('  + set: end of protected region');
            return result;
        }

        loggerSet.debug('  + set: running protected region...');
        let result = await this.storageDriver.lock.run(protectedCode);
        loggerSet.debug('  + set: ...done running protected region.  result =', result);

        if (this._isClosed) { throw new StorageIsClosedError(); }
        loggerSet.debug('set is done.');

        return result;
    }

    async ingest(docToIngest: Doc, _bypassLock: boolean = false): Promise<IngestResultAndDoc> {
        // set _bypassLock to true to skip getting the lock --
        // use it when this is called from set() which has already grabbed the lock.

        loggerIngest.debug(`ingest`, docToIngest);
        if (this._isClosed) { throw new StorageIsClosedError(); }

        loggerIngest.debug('    removing extra fields');
        let removeResultsOrErr = this.formatValidator.removeExtraFields(docToIngest);
        if (isErr(removeResultsOrErr)) { return { ingestResult: IngestResult.Invalid, docIngested: null }; }
        docToIngest = removeResultsOrErr.doc;  // a copy of doc without extra fields
        let extraFields = removeResultsOrErr.extras;  // any extra fields starting with underscores
        if (Object.keys(extraFields).length > 0) {
            loggerIngest.debug(`    ....extra fields found: ${JSON.stringify(extraFields)}`);
        }

        // now actually check doc validity against core schema
        let docIsValid = this.formatValidator.checkDocumentIsValid(docToIngest);
        if (isErr(docIsValid)) { return { ingestResult: IngestResult.Invalid, docIngested: null }; }

        let protectedCode = async (): Promise<IngestResultAndDoc> => {
            // get other docs at the same path
            loggerIngest.debug(' >> ingest: start of protected region');
            loggerIngest.debug('  > getting other docs at the same path');
            if (this._isClosed) { throw new StorageIsClosedError(); }
            let existingDocsSamePath = await this.getAllDocsAtPath(docToIngest.path);

            // check if this is obsolete or redudant from the same other
            loggerIngest.debug('  > checking if obsolete from same author');
            let existingDocSameAuthor = existingDocsSamePath.filter(d =>
                d.author === docToIngest.author)[0];
            if (existingDocSameAuthor !== undefined) {
                let docComp = docCompareForOverwrite(docToIngest, existingDocSameAuthor);
                if (docComp === Cmp.LT) { return { ingestResult: IngestResult.ObsoleteFromSameAuthor, docIngested: null }; }
                if (docComp === Cmp.EQ) { return { ingestResult: IngestResult.AlreadyHadIt, docIngested: null }; }
            }
        
            // check if latest
            loggerIngest.debug('  > checking if latest');
            let isLatest = true;
            for (let d of existingDocsSamePath) {
                // TODO: use docCompareForOverwrite or something
                if (docToIngest.timestamp < d.timestamp) { isLatest = false; break; }
            }

            // save it
            loggerIngest.debug('  > upserting into storageDriver...');
            let docResult = await this.storageDriver.upsert(docToIngest);
            loggerIngest.debug('  > ...done upserting into storageDriver');
            loggerIngest.debug(' >> ingest: end of protected region');

            if (!docResult) { return { ingestResult: IngestResult.WriteError, docIngested: null}; }
            return isLatest
                ? { ingestResult: IngestResult.AcceptedAndLatest, docIngested: docResult }
                : { ingestResult: IngestResult.AcceptedButNotLatest, docIngested: docResult }
        };

        loggerIngest.debug(' >> ingest: running protected region...');
        // bypass the lock if we are already in a lock (because we're being called from set())
        let result: IngestResultAndDoc = await this.storageDriver.lock.run(protectedCode, { bypass: _bypassLock });
        let { ingestResult, docIngested } = result;
        loggerIngest.debug(' >> ingest: ...done running protected region', ingestResult);

        if (this._isClosed) { throw new StorageIsClosedError(); }

        // only send events if we successfully ingested a doc
        if (docIngested !== null) {
            loggerIngest.debug('  - ingest: send ingest event blockingly...');
            await this.bus.sendAndWait(('ingest|' + docIngested.path) as 'ingest', docIngested);
            loggerIngest.debug('  - ingest: ...done sending ingest event');
        }

        return result;
    }

    // overwrite every doc with an empty one, from this author:
    // return the number of docs changed, or -1 if error.
    async overwriteAllDocsByAuthor(keypair: AuthorKeypair): Promise<number | ValidationError> {
        logger.debug(`overwriteAllDocsByAuthor("${keypair.address}")`);
        // TODO: do this in batches
        let docsToOverwrite = await this.queryDocs({
            filter: { author: keypair.address, },
            historyMode: 'all',
        });
        logger.debug(`    ...found ${docsToOverwrite.length} docs to overwrite`);
        let numOverwritten = 0;
        let numAlreadyEmpty = 0;
        for (let doc of docsToOverwrite) {
            if (doc.content.length === 0) {
                numAlreadyEmpty += 1;
                continue;
            }

            // remove extra fields
            let cleanedResult = this.formatValidator.removeExtraFields(doc);
            if (isErr(cleanedResult)) { return cleanedResult; }
            let cleanedDoc = cleanedResult.doc;

            // make new doc which is empty and just barely newer than the original
            let emptyDoc: Doc = {
                ...cleanedDoc,
                content: '',
                contentHash: Crypto.sha256base32(''),
                timestamp: doc.timestamp + 1,
                signature: '?',
            }

            // sign and ingest it
            let signedDoc = this.formatValidator.signDocument(keypair, emptyDoc)
            if (isErr(signedDoc)) { return signedDoc }

            let { ingestResult, docIngested } = await this.ingest(signedDoc);
            if (ingestResult !== IngestResult.AcceptedAndLatest && ingestResult !== IngestResult.AcceptedButNotLatest) {
                return new ValidationError('ingestion error during overwriteAllDocsBySameAuthor: ' + ingestResult);
            }

            numOverwritten += 1;
        }
        logger.debug(`    ...done; ${numOverwritten} overwritten to be empty; ${numAlreadyEmpty} were already empty; out of total ${docsToOverwrite.length} docs`);
        return numOverwritten;
    }
}
