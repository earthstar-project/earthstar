import {
    Superbus
} from 'superbus';
import {
    Lock
} from 'concurrency-friends';

import {
    Cmp, Thunk,
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
    LiveQueryEvent,
    StorageEventWillClose,
    StorageEventDidClose,
} from './storage-types';
import {
    IFormatValidator,
} from '../format-validators/format-validator-types';

import {
    isErr,
    NotImplementedError,
    StorageIsClosedError,
    ValidationError,
} from '../util/errors';
import {
    microsecondNow, randomId, sleep,
} from '../util/misc';
import {
    compareArrays,
} from './compare';

import { Crypto } from '../crypto/crypto';
import { docMatchesFilter } from '../query/query';

//--------------------------------------------------

import { Logger, LogLevel, setDefaultLogLevel, setLogLevel } from '../util/log';
let J = JSON.stringify;
let logger = new Logger('storage async', 'yellowBright');
let loggerSet = new Logger('storage async set', 'yellowBright');
let loggerIngest = new Logger('storage async ingest', 'yellowBright');
let loggerLiveQuery = new Logger('storage live query', 'magentaBright');
let loggerLiveQuerySubscription = new Logger('storage live query subscription', 'magenta');

//setDefaultLogLevel(LogLevel.None);
//setLogLevel('storage async', LogLevel.Debug);
//setLogLevel('storage async set', LogLevel.Debug);
//setLogLevel('storage async ingest', LogLevel.Debug);
//setLogLevel('storage live query', LogLevel.Debug);
//setLogLevel('storage live query subscription', LogLevel.Debug);

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

    //--------------------------------------------------
    /**
     * Subscribe to the ongoing results of a query.
     * When anything happens, call the given callback.
     * 
     * The given callback can be sync or async.
     * It will be called blockingly and new events will not be fed to it
     * until it finishes the one it's handling, one at a time.
     * 
     * The callback will be fed a variety of events:
     *   (see LiveQueryEvent in storageTypes for a comprehensive list)
     * 
     *   - DocAlreadyExists -- when catching up with old docs
     *   - IngestEvent
     *   -     IngestEventSuccess -- a new doc was written
     *   -     IngestEventFailure -- refused an invalid doc
     *   -     IngestEventNothingHappened -- ingested an obsolete or duplicate doc
     *   - StorageEventWillClose -- the storage is about to close
     *   - StorageEventDidClose -- the storage has closed
     * 
     * The query has some limitations:
     *   - historyMode must be 'all'
     *   - orderBy must be 'localIndex ASC'
     *   - limit cannot be set (TODO: fix this eventually)
     * 
     * The query's startAfter controls the behavior of the live query:
     *   - If startAfter is not set, we begin with the next write event that occurs, and ignore
     *      existing documents.
     *   - If startAfter is set to a localIndex value, begin there.  This may involve running
     *      through a backlog of existing documents, then eventually catching up and switching
     *      over to write events as new things happen.
     *      The usual use case for this is to set startAfter to localIndex: -1 to begin processing
     *      with the oldest doc (to get all of them).
     * 
     *  So the liveQuery can be in two modes:
     *    1. catching up with the backlog
     *    2. caught up; processing new events as they happen.
     * 
     *  When the liveQuery is in catching-up-with-the-backlog mode, it has no effect on
     *  new concurrent writes.
     * 
     *  When the liveQuery is caught up and is handling new events as they happen, it will block
     *  those events as it processes each one with its callback.
     * 
     *  liveQuery returns an unsubscribe function that can be used to stop handling future events.
     *  However there's currently no way to abort it when it's in catching-up mode; in fact you can't
     *  even get your hands on the unsub function until it's done catching up.
     * 
     *  Two ways to use this:
     * 
     *      // Start a liveQuery and block until it's done catching up to the most recent doc.
     *      // This gives you access to the unsub function.
     *      let unsub = await liveQuery({... your query ...}, (event) => {... your callback ...});
     *      //...Later, you can unsub (when it's caught-up).
     *      unsub();
     * 
     *      // OR, don't await it, and let it catch up on its own time.
     *      // You will not be able to stop it or unsub it.
     *      liveQuery({... your query ...}, (event) => {... your callback ...});
     * 
     *  TODO: let the callback return something special (false?) to kill the liveQuery no matter
     *    what phase it's in.
     *  TODO: throttle the catching-up mode so it doesn't hog the CPU.
     *  TODO: catch-up in smaller batches instead of one giant batch, to save memory.
     */
    async liveQuery(query: Query, cb: (event: LiveQueryEvent) => Promise<void>): Promise<Thunk> {
        loggerLiveQuery.debug(`starting live query: ${J(query)}`);

        // enforce rules on supported queries
        if (query.historyMode !== 'all') { throw new NotImplementedError(`live query historyMode must be 'all'`); }
        if (query.orderBy !== 'localIndex ASC') { throw new NotImplementedError(`live query orderBy must be 'localIndex ASC'`); }
        if (query.limit !== undefined) { throw new NotImplementedError(`live query must not have a limit`); }

        // if query specifies a startAfter, start there and catch up with existing docs.
        if (query.startAfter) {
            loggerLiveQuery.debug(`live query has a startAfter already; catching up.`);
            while (true) {
                let asOf1: number = -100;  // before query
                let asOf2: number = -100;  // after query; before callbacks, doesn't really matter
                let asOf3: number = -100;  // after callbacks
                let maxReturned: number = -100;
                try {
                    asOf1 = this.storageDriver.getMaxLocalIndex();
                    loggerLiveQuery.debug(`...at ${asOf1}, started querying for existing docs`);
                    // TODO: catch up in smaller batches by setting a limit in the query
                    let existingDocs = await this.queryDocs(query);
                    for (let doc of existingDocs) {
                        maxReturned = Math.max(maxReturned, doc._localIndex ?? -1);
                    }
                    asOf2 = this.storageDriver.getMaxLocalIndex();
                    loggerLiveQuery.debug(`...at ${asOf2}, got ${existingDocs.length} existing docs`);
                    loggerLiveQuery.debug(`...running cb on existing docs`);
                    for (let doc of existingDocs) {
                        let result = cb({
                            kind: 'existing',
                            maxLocalIndex: this.storageDriver.getMaxLocalIndex(),
                            doc: doc,
                        });
                        // only await if cb was an async function that returned a promise
                        if (result instanceof Promise) { await result; }
                    }
                    asOf3 = this.storageDriver.getMaxLocalIndex();
                    loggerLiveQuery.debug(`...at ${asOf3}, finished running ${existingDocs.length} callbacks for existing docs`);
                } catch (err) {
                    if (err instanceof StorageIsClosedError) {
                        loggerLiveQuery.debug(`storage was closed while we were catching up, oh well.`);
                        return () => {}; // return empty unsubscribe
                    } else {
                        throw err;
                    }
                }

                let asOfSummary = `( asOf: ${asOf1} [query] ${asOf2} [callbacks] ${asOf3}.  maxReturned: ${maxReturned} )`;
                loggerLiveQuery.debug(`...query and callback summary: ${asOfSummary}`);
                if (asOf1 === asOf3) {
                    loggerLiveQuery.debug(`...asOf stayed at ${asOf1} so nothing new has happened since we did the query, so we can stop catching up now.`);
                    loggerLiveQuery.debug(`...setting startAfter to localIndex: ${asOf1}`);
                    // no changes; we can stop catching up
                    // and let's set startAfter to continue where we just left off.
                    query.startAfter = { localIndex: asOf1 };
                    break;
                } else {
                    // changes happened.
                    // wait a moment, then do another query to keep catching up.
                    loggerLiveQuery.debug(`...asOf went from ${asOf1} to ${asOf3} so changes happened since we did our query; gotta query again to get those changes.`);
                    loggerLiveQuery.debug(`...setting startAfter to localIndex: ${maxReturned} which is the max returned doc we saw.`);
                    query.startAfter = { localIndex: maxReturned };
                    await sleep(10);
                }
            }
        } else {
            loggerLiveQuery.debug(`live query does not have a startAfter already; only getting new events starting now.`);
        }

        // if query did not specify a startAfter, we will start with the next
        // ingest event that happens.

        let queryFilter = query.filter || {};
        let queryStartAfter = this.storageDriver.getMaxLocalIndex();
        if (query.startAfter !== undefined && query.startAfter.localIndex !== undefined) {
            queryStartAfter = query.startAfter.localIndex;
        }
        loggerLiveQuery.debug(`OK: live query is switching to subscription mode:`);
        loggerLiveQuery.debug(`...queryFilter: ${J(queryFilter)}`);
        loggerLiveQuery.debug(`...start paying attention after local index ${queryStartAfter}.  subscribing...`);

        let unsub = this.bus.on('*', async (channel: StorageBusChannel | '*', data: any) => {
            loggerLiveQuerySubscription.debug(`--- live query subscription: got an event on channel ${channel}`);
            let event = data as LiveQueryEvent;
            if (channel === 'willClose') {
                let event: StorageEventWillClose = {
                    kind: 'willClose',
                    maxLocalIndex: this.storageDriver.getMaxLocalIndex(),
                }
                await cb(event);
            } else if (channel === 'didClose') {
                let event: StorageEventDidClose = {
                    kind: 'didClose',
                }
                await cb(event);
            } else if (data === undefined || data.kind === undefined) {
                loggerLiveQuerySubscription.error('weird event on channel ', channel);
                return;

            // ingest events
            } else if (event.kind === 'success') {
                // let events through that are after our query's startAfter
                // and match our query's filter
                loggerLiveQuerySubscription.debug(`--- it's a write success.  do we care?`);
                let doc_li = event.doc._localIndex ?? -1;
                let query_sa = queryStartAfter;
                if (doc_li <= query_sa) {
                    loggerLiveQuerySubscription.debug(`--- don't care; localIndex is old (doc.localIndex ${doc_li} <= queryStartAfter ${query_sa})`);
                } else {
                    if (!docMatchesFilter(event.doc, queryFilter)) {
                        loggerLiveQuerySubscription.debug(`--- don't care; filter doesn't match`);
                    } else {
                        loggerLiveQuerySubscription.debug(`--- we care! filter matches (if there is one) and doc.localIndex comes after query.startAt.`);
                        loggerLiveQuerySubscription.debug(`--- running callback blockingly...`);
                        await cb(event);
                        loggerLiveQuerySubscription.debug(`--- ...done running callback`);
                    }
                }
            // let all the other kinds of events through
            } else if (event.kind === 'failure') {
                loggerLiveQuerySubscription.debug(`--- ingest failure event`);
                await cb(event);
            } else if (event.kind === 'nothing_happened') {
                loggerLiveQuerySubscription.debug(`--- nothing happened event`);
                await cb(event);
            } else {
                loggerLiveQuerySubscription.debug(`--- WARNING: unknown event type event`);
                console.warn('this should never happen:', event);
                console.warn('this should never happen: unrecognised kind of LiveQueryEvent: ' + event.kind);
            }
        });
        return unsub;
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
        loggerIngest.debug('...ingest event:', ingestEvent);
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
