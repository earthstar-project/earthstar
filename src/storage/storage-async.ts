import {
    Superbus
} from 'superbus';
import {
    Lock
} from 'concurrency-friends';

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
    QueryResult,
    StorageBusChannel,
    StorageId,
    IngestEvent,
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
let J = JSON.stringify;

//================================================================================

let docCompareNewestFirst = (a: Doc, b: Doc): Cmp => {
    // Sorts by timestamp DESC (newest fist) and breaks ties using the signature ASC.
    return compareArrays(
        [a.timestamp, a.signature],
        [b.timestamp, a.signature],
        ['DESC', 'ASC'],
    );
}

export class StorageAsync implements IStorageAsync {
    storageId: StorageId;
    workspace: WorkspaceAddress;
    formatValidator: IFormatValidator;
    storageDriver: IStorageDriverAsync;
    bus: Superbus<StorageBusChannel>;

    _isClosed: boolean = false;
    _ingestLock: Lock<IngestEvent>;

    constructor(workspace: WorkspaceAddress, validator: IFormatValidator, driver: IStorageDriverAsync) {
        logger.debug(`constructor.  driver = ${(driver as any)?.constructor?.name}`);
        this.storageId = 'storage-' + randomId();
        this.workspace = workspace;
        this.formatValidator = validator;
        this.storageDriver = driver;
        this.bus = new Superbus<StorageBusChannel>('|');
        this._ingestLock = new Lock<IngestEvent>();
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

    async set(keypair: AuthorKeypair, docToSet: DocToSet): Promise<IngestEvent> {
        loggerSet.debug(`set`, docToSet);
        if (this._isClosed) { throw new StorageIsClosedError(); }

        loggerSet.debug('...deciding timestamp: getting latest doc at the same path (from any author)');
        if (this._isClosed) { throw new StorageIsClosedError(); }

        let timestamp: number;
        if (typeof docToSet.timestamp === 'number') {
            timestamp = docToSet.timestamp;
            loggerSet.debug('...docToSet already has a timestamp; not changing it from ', timestamp);
        } else {
            // bump timestamp if needed to win over existing latest doc at same path
            let latestDocSamePath = await this.getLatestDocAtPath(docToSet.path);
            if (latestDocSamePath === undefined) {
                timestamp = microsecondNow();
                loggerSet.debug('...no existing latest doc, setting timestamp to now() =', timestamp);
            } else {
                timestamp = Math.max(microsecondNow(), latestDocSamePath.timestamp + 1);
                loggerSet.debug('...existing latest doc found, bumping timestamp to win if needed =', timestamp);
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

        loggerSet.debug('...signing doc');
        let signedDoc = this.formatValidator.signDocument(keypair, doc);
        if (isErr(signedDoc)) {
            return {
                kind: 'failure',
                reason: 'invalid_document',
                err: signedDoc,
                maxLocalIndex: this.storageDriver.getMaxLocalIndex(),
            }
        }
        loggerSet.debug('...signature =', signedDoc.signature);

        loggerSet.debug('...ingesting');
        loggerSet.debug('-----------------------');
        let ingestEvent = await this.ingest(signedDoc);
        loggerSet.debug('-----------------------');
        loggerSet.debug('...done ingesting');
        loggerSet.debug('...set is done.');
        return ingestEvent;
    }

    async ingest(docToIngest: Doc): Promise<IngestEvent> {
        loggerIngest.debug(`ingest`, docToIngest);
        if (this._isClosed) { throw new StorageIsClosedError(); }

        loggerIngest.debug('...removing extra fields');
        let removeResultsOrErr = this.formatValidator.removeExtraFields(docToIngest);
        if (isErr(removeResultsOrErr)) {
            return {
                kind: 'failure',
                reason: 'invalid_document',
                err: removeResultsOrErr,
                maxLocalIndex: this.storageDriver.getMaxLocalIndex(),
            }
        }
        docToIngest = removeResultsOrErr.doc;  // a copy of doc without extra fields
        let extraFields = removeResultsOrErr.extras;  // any extra fields starting with underscores
        if (Object.keys(extraFields).length > 0) {
            loggerIngest.debug(`...extra fields found: ${J(extraFields)}`);
        }

        // now actually check doc validity against core schema
        let docIsValid = this.formatValidator.checkDocumentIsValid(docToIngest);
        if (isErr(docIsValid)) {
            return {
                kind: 'failure',
                reason: 'invalid_document',
                err: docIsValid,
                maxLocalIndex: this.storageDriver.getMaxLocalIndex(),
            }
        }

        let writeToDriverWithLock = async (): Promise<IngestEvent> => {
            // get other docs at the same path
            loggerIngest.debug(' >> ingest: start of protected region');
            loggerIngest.debug('  > getting other history docs at the same path by any author');
            let existingDocsSamePath = await this.getAllDocsAtPath(docToIngest.path);
            loggerIngest.debug(`  > ...got ${existingDocsSamePath.length}`);

            loggerIngest.debug('  > getting prevLatest and prevSameAuthor');
            let prevLatest: Doc | null = existingDocsSamePath[0] ?? null;
            let prevSameAuthor: Doc | null = existingDocsSamePath.filter(d => d.author === docToIngest.author)[0] ?? null;

            loggerIngest.debug('  > checking if new doc is latest at this path');
            existingDocsSamePath.push(docToIngest);
            existingDocsSamePath.sort(docCompareNewestFirst);
            let isLatest = existingDocsSamePath[0] === docToIngest;
            loggerIngest.debug(`  > ...isLatest: ${isLatest}`);

            if (!isLatest && prevSameAuthor !== null) {
                loggerIngest.debug('  > new doc is not latest and there is another one from the same author...');
                // check if this is obsolete or redudant from the same author
                let docComp = docCompareNewestFirst(docToIngest, prevSameAuthor);
                if (docComp === Cmp.GT) {
                    loggerIngest.debug('  > new doc is GT prevSameAuthor, so it is obsolete');
                    return {
                        kind: 'nothing_happened',
                        reason: 'obsolete_from_same_author',
                        doc: docToIngest,
                        maxLocalIndex: this.storageDriver.getMaxLocalIndex(),
                    };
                }
                if (docComp === Cmp.EQ) {
                    loggerIngest.debug('  > new doc is EQ prevSameAuthor, so it is redundant (already_had_it)');
                    return {
                        kind: 'nothing_happened',
                        reason: 'already_had_it',
                        doc: docToIngest,
                        maxLocalIndex: this.storageDriver.getMaxLocalIndex(),
                    };
                }
            }

            // save it
            loggerIngest.debug('  > upserting into storageDriver...');
            let docAsWritten = await this.storageDriver.upsert(docToIngest);  // TODO: pass existingDocsSamePath to save another lookup
            loggerIngest.debug('  > ...done upserting into storageDriver');
            loggerIngest.debug('  > ...getting storageDriver maxLocalIndex...');
            let maxLocalIndex = this.storageDriver.getMaxLocalIndex();

            loggerIngest.debug(' >> ingest: end of protected region, returning a WriteEvent from the lock');
            return {
                kind: 'success',
                maxLocalIndex,
                doc: docAsWritten,  // with updated extra properties like _localIndex
                docIsLatest: isLatest,
                prevDocFromSameAuthor: prevSameAuthor,
                prevLatestDoc: prevLatest,
            };
        };

        loggerIngest.debug(' >> ingest: running protected region...');
        let ingestEvent: IngestEvent = await this._ingestLock.run(writeToDriverWithLock);
        loggerIngest.debug(' >> ingest: ...done running protected region');

        loggerIngest.debug('...send ingest event after releasing the lock');
        await this.bus.sendAndWait(`ingest|${docToIngest.path}` as 'ingest', ingestEvent); // include the path in the channel even on failures

        return ingestEvent;
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

            let ingestEvent = await this.ingest(signedDoc);
            if (ingestEvent.kind === 'failure') {
                return new ValidationError('ingestion error during overwriteAllDocsBySameAuthor: ' + ingestEvent.reason + ': ' + ingestEvent.err);
            } if (ingestEvent.kind === 'nothing_happened') {
                return new ValidationError('ingestion did nothing during overwriteAllDocsBySameAuthor: ' + ingestEvent.reason);
            } else {
                // success
                numOverwritten += 1;
            }
        }
        logger.debug(`    ...done; ${numOverwritten} overwritten to be empty; ${numAlreadyEmpty} were already empty; out of total ${docsToOverwrite.length} docs`);
        return numOverwritten;
    }
}
