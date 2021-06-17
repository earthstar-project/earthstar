import {
    Simplebus,
    Superbus
} from 'superbus';

import {
    Thunk,
} from '../storage/util-types';
import {
    Doc,
} from '../util/doc-types';
import {
    Query,
} from '../query/query-types';
import {
    NotImplementedError, StorageIsClosedError,
} from '../util/errors';
import {
    IStorageAsync,
    IngestEvent,
    LiveQueryEvent,
    DocAlreadyExists,
    QueryFollower3DidClose,
    StorageBusChannel,
    StorageEventWillClose,
    StorageEventDidClose,
    IdleEvent,
} from '../storage/storage-types';
import {
    docMatchesFilter,
} from '../query/query';
import {
    IQueryFollower,
    IQueryFollower3,
    QueryFollower1Event,
    QueryFollower3State,
} from './query-follower-types';

//================================================================================

import { Logger, LogLevel, setDefaultLogLevel, setLogLevel } from '../util/log';
import { deepCopy, sleep } from '../util/misc';
let logger = new Logger('QueryFollower', 'redBright');
let loggerSub = new Logger('QueryFollowerSub', 'red');
let J = JSON.stringify;

setLogLevel('QueryFollower', LogLevel.Debug);
setLogLevel('QueryFollowerSub', LogLevel.Debug);

//================================================================================

export class QueryFollower3 implements IQueryFollower3 {
    storage: IStorageAsync;
    query: Query;
    bus: Simplebus<LiveQueryEvent>;
    _state: QueryFollower3State = 'new';
    _unsub: Thunk | null = null; // to unsub from storage events

    constructor(storage: IStorageAsync, query: Query) {
        logger.debug('constructor');
        this.storage = storage;
        this.query = deepCopy(query);  // we'll modify the query as we go, changing the startAfter
        this.bus = new Simplebus<LiveQueryEvent>();

        // enforce rules on supported queries
        logger.debug('...enforcing rules on supported queries');
        if (query.historyMode !== 'all') { throw new NotImplementedError(`QueryFollower3 historyMode must be 'all'`); }
        if (query.orderBy !== 'localIndex ASC') { throw new NotImplementedError(`QueryFollower3 orderBy must be 'localIndex ASC'`); }
        if (query.limit !== undefined) { throw new NotImplementedError(`QueryFollower3 must not have a limit`); }
    }

    _expectState(states: QueryFollower3State[]) {
        if (states.indexOf(this._state) === -1) {
            throw new Error(`QueryFollower3 expected state to be one of ${J(states)} but instead found ${this._state}`);
        }
    }

    state(): QueryFollower3State {
        logger.debug('state() => ' + this._state);
        return this._state;
    }

    async hatch(): Promise<void> {
        logger.debug('hatch...');

        this._expectState(['new']);

        logger.debug('...hatch: calling _catchUp');
        await this._catchUp();
        this._expectState(['closed', 'error', 'live']);
        logger.debug('...hatch: done calling _catchUp');
        logger.debug(`...hatch: state is "${this._state}"`);

        logger.debug(`...hatch is done`);
    }

    async _catchUp(): Promise<void> {
        // call this from state "new"
        // pass through state "catching-up"
        // end in state:
        //  "live" is we finished catching up and started the live subscription to the storage
        //  "closed" if storage became closed
        //  "error" if something else happened, probably an error from the bus handler

        logger.debug('_catchUp...');
        this._expectState(['new']);

        let storage = this.storage;
        let driver = this.storage.storageDriver;
        let query = this.query;

        if (query.startAfter === undefined) {
            logger.debug(`..._catchUp was not needed becaue startAfter is undefined, so we're going right to live mode.`);
            this._state = 'live';
            // the moment we become live, we're idle
            let idleEvent: IdleEvent = { kind: 'idle' };
            await this.bus.send(idleEvent);
            this._subscribe();
            return;
        }

        // catch up if needed
        this._state = 'catching-up';
        logger.debug(`QueryFollower3 has a startAfter already; catching up.`);
        while (true) {
            let asOf1: number = -100;  // before query
            let asOf2: number = -100;  // after query; before callbacks, doesn't really matter
            let asOf3: number = -100;  // after callbacks
            let maxReturned: number = -100;
            // do a query
            try {
                asOf1 = driver.getMaxLocalIndex();
                logger.debug(`...at ${asOf1}, started querying for existing docs`);
                // TODO: catch up in smaller batches by setting a limit in the query
                // TODO: check often to see if the queryfollower itself has been closed
                let existingDocs = await storage.queryDocs(query);
                for (let doc of existingDocs) {
                    maxReturned = Math.max(maxReturned, doc._localIndex ?? -1);
                }
                asOf2 = driver.getMaxLocalIndex();
                logger.debug(`...at ${asOf2}, got ${existingDocs.length} existing docs`);
                logger.debug(`...sending docs to bus...`);
                for (let doc of existingDocs) {
                    let event: DocAlreadyExists = {
                        kind: 'existing',
                        maxLocalIndex: asOf2,
                        doc: doc,  // TODO: should be the just-written doc, frozen, with updated extra properties like _localIndex
                    }
                    await this.bus.send(event);
                }
                asOf3 = driver.getMaxLocalIndex();
                logger.debug(`...at ${asOf3}, finished running ${existingDocs.length} callbacks for existing docs`);
            } catch (err) {
                if (err instanceof StorageIsClosedError) {
                    logger.debug(`storage was closed while we were catching up, oh well.`);
                    this.close();
                } else {
                    // TODO: what now?  are we stuck in 'error' state?
                    // should we close?
                    this._state = 'error';
                    throw err;
                }
            }

            // check for stopping conditions for query catch-up loop
            let asOfSummary = `( asOf: ${asOf1} [query] ${asOf2} [callbacks] ${asOf3}.  maxReturned: ${maxReturned} )`;
            logger.debug(`...query and callback summary: ${asOfSummary}`);
            if (asOf1 === asOf3) {
                logger.debug(`...asOf stayed at ${asOf1} so nothing new has happened since we did the query, so we can stop catching up now.`);
                logger.debug(`...setting startAfter to localIndex: ${asOf1}`);
                // no changes; we can stop catching up
                // and let's set startAfter to continue where we just left off.
                query.startAfter = { localIndex: asOf1 };
                this._state = 'live';
                // the moment we become live, we're idle
                let idleEvent: IdleEvent = { kind: 'idle' };
                await this.bus.send(idleEvent);
                this._subscribe();
                break;
            } else {
                // changes happened.
                // wait a moment, then do another query to keep catching up.
                logger.debug(`...asOf went from ${asOf1} to ${asOf3} so changes happened since we did our query; gotta query again to get those changes.`);
                logger.debug(`...setting startAfter to localIndex: ${maxReturned} which is the max returned doc we saw.`);
                query.startAfter = { localIndex: maxReturned };
                await sleep(10);
            }

        } // end of while(true) loop

        logger.debug(`..._catchUp is done, we should now be live: '${this.state()}'`);
        this._expectState(['live']);
    }

    _subscribe() {
        // if query did not specify a startAfter, we will start with the next
        // ingest event that happens.

        // we have just entered live mode, so we need to subscribe to new events.
        // we'll return an unsubscribe function.

        logger.debug('_subscribe...');
        this._expectState(['live']);

        let driver = this.storage.storageDriver;
        let query = this.query;

        let queryFilter = query.filter || {};
        let queryStartAfter = driver.getMaxLocalIndex();
        if (query.startAfter !== undefined && query.startAfter.localIndex !== undefined) {
            queryStartAfter = query.startAfter.localIndex;
        }
        logger.debug(`OK: QueryFollower3 is switching to subscription mode:`);
        logger.debug(`...queryFilter: ${J(queryFilter)}`);
        logger.debug(`...start paying attention after local index ${queryStartAfter}.  subscribing...`);

        this._unsub = this.storage.bus.on('*', async (channel: StorageBusChannel | '*', data: any) => {
            this._expectState(['live']);  // make sure the query follower itself has not been closed

            loggerSub.debug(`--- QueryFollower3 subscription: got an event on channel ${channel}`);
            let event = data as LiveQueryEvent;
            if (channel === 'willClose') {
                let event: StorageEventWillClose = {
                    kind: 'willClose',
                    maxLocalIndex: driver.getMaxLocalIndex(),
                }
                await this.bus.send(event);
            } else if (channel === 'didClose') {
                let event: StorageEventDidClose = {
                    kind: 'didClose',
                }
                loggerSub.debug('storage did close.  sending that event...');
                await this.bus.send(event);
                loggerSub.debug('storage did close.  ...and closing the queryFollower...');
                await this.close();
                loggerSub.debug('storage did close.  ...done.');
            } else if (data === undefined || data.kind === undefined) {
                loggerSub.error('weird event on channel ', channel);
                return;
            // ingest events
            } else if (event.kind === 'success') {
                // let events through that are after our query's startAfter
                // and match our query's filter
                loggerSub.debug(`--- it's a write success.  do we care?`);
                let doc_li = event.doc._localIndex ?? -1;
                let query_sa = queryStartAfter;
                if (doc_li <= query_sa) {
                    loggerSub.debug(`--- don't care; localIndex is old (doc.localIndex ${doc_li} <= queryStartAfter ${query_sa})`);
                } else {
                    if (!docMatchesFilter(event.doc, queryFilter)) {
                        loggerSub.debug(`--- don't care; filter doesn't match`);
                    } else {
                        loggerSub.debug(`--- we care! filter matches (if there is one) and doc.localIndex comes after query.startAt.`);
                        loggerSub.debug(`--- running callback blockingly...`);
                        await this.bus.send(event);
                        loggerSub.debug(`--- ...done running callback`);
                    }
                }
            // let all the other kinds of events through
            } else if (event.kind === 'failure') {
                loggerSub.debug(`--- ingest failure event`);
                await this.bus.send(event);
            } else if (event.kind === 'nothing_happened') {
                loggerSub.debug(`--- nothing happened event`);
                await this.bus.send(event);
            } else {
                loggerSub.debug(`--- WARNING: unknown event type event`);
                console.warn('this should never happen:', event);
                console.warn('this should never happen: unrecognised kind of LiveQueryEvent: ' + event.kind);
            }
        });
    }

    async close(): Promise<void> {
        if (this._state === 'closed') { return; }
        logger.debug('close...');

        this._state = 'closed';
        if (this._unsub) { this._unsub; }

        let event: QueryFollower3DidClose = { kind: 'queryFollower3DidClose' };
        await this.bus.send(event);

        logger.debug('...close is done.');
    }
}




//================================================================================
//================================================================================
//================================================================================

/**
 * @deprecated - replaced with StorageAsync.liveQuery()
 */
export class QueryFollower implements IQueryFollower {
    storage: IStorageAsync;
    bus: Superbus<QueryFollower1Event>;

    _query: Query;
    _cb: (doc: Doc) => Promise<void>;
    _maxLocalIndex: number = -1;
    _isClosed: boolean = false;

    _unsubIngest: Thunk;
    _unsubClose: Thunk;

    /**
     * When the storage ingests a new doc that matches the given query,
     * call the callback on it.
     * Only some kinds of queries are supported:
     * queries must have these specific settings:
     *      { historyMode: 'all', orderBy: 'localIndex ASC' }
     * queries may have:
     *      { startAfter: { localIndex: number }}  // to start the follower partway through the sequence
     *      { filter: { ... any filters ... }}  // to filter the docs
     * queries may not have:
     *      { limit: number }  // TODO: allow this, and stop after processing this many docs
     */
    // TODO: event for becoming busy, the opposite of catch-up
    constructor(storage: IStorageAsync, query: Query, cb: (doc: Doc) => Promise<void>) {
        logger.debug('constructor', query);

        this.storage = storage;
        this._query = query;
        this._cb = cb;

        this.bus = new Superbus<QueryFollower1Event>();

        // enforce rules on supported queries
        if (this._query.historyMode !== 'all') { throw new NotImplementedError(`query historyMode must be 'all'`); }
        if (this._query.orderBy !== 'localIndex ASC') { throw new NotImplementedError(`query orderBy must be 'localIndex ASC'`); }
        if (this._query.limit !== undefined) { throw new NotImplementedError(`query must not have a limit`); }

        // startAfter is equivalent to maxLocalIndex -- both are the max known value, not the next one that we want (+1)
        if (query.startAfter?.localIndex !== undefined) {
            this._maxLocalIndex = query.startAfter?.localIndex;
        }
        logger.debug('my _maxLocalIndex is starting at', this._maxLocalIndex);

        // when storage closes, close this QueryFollower too.
        this._unsubClose = this.storage.bus.once('willClose', async () => {
            logger.debug('on storage willClose, closing blockingly...');
            await this.close();
            logger.debug('...done closing');
        }, { mode: 'blocking' });

        // subscribe to storage events.
        // we process docs in two ways:
        // 1. this subscription, when we get one doc at a time as they are sent to us by the storage
        //     if we're still caught up
        // 2. our _catchUp method, which is used when we've fallen behind and need to query for
        //     batches of docs to process
        // We don't want these to both run at the same time.
        // TODO: what happens when this event fires and we're in the middle of a long _catchUp process?
        //  We need to lock the storage so that can't happen, or maintain a variable of our catching-up state
        //  so we can skip this event handler when we're catching-up.
        //  Or it might not happen because all these events are blocking events so maybe the storage won't
        //  accept any docs until our catchUp process is all done.
        this._unsubIngest = this.storage.bus.on('ingest', async (channel: string, ingestEvent: IngestEvent) => {
            if (ingestEvent.kind !== 'success') { return; }

            let { doc, maxLocalIndex, prevDocFromSameAuthor, prevLatestDoc, docIsLatest } = ingestEvent;

            logger.debug(`on storage 'ingest' event.  doc._localIndex: ${doc._localIndex}; overall maxLocalIndex: ${maxLocalIndex}; channel: ${channel}`);
            if (this.isClosed()) { logger.debug(`stopping catch-up because we're closed`); return; }

            let docIsInteresting = docMatchesFilter(doc, this._query.filter ?? {});
            logger.debug('the doc matches our filters:', docIsInteresting);

            if (doc._localIndex === this._maxLocalIndex + 1) {
                // We've gotten the next doc in the localIndex sequence without any gaps,
                // so we know we can process it right away and we don't need to catch up.
                logger.debug('this follower is on the leading edge.  looking at this doc...');

                // Update our pointer, even if we're not going to process this document because of our query filter.
                this._maxLocalIndex += 1;

                if (docIsInteresting) {
                    logger.debug('...doc matches query filter.  running callback blockingly...');
                    await this._cb(doc);
                    logger.debug('...done with callback.');

                    logger.debug('...sending caught-up event');
                    await this.bus.sendAndWait('caught-up');
                    logger.debug('...done sending caught-up event');
                } else {
                    logger.debug('...doc does not match filter; skipping callback; we are still caught up.');
                }
            } else {
                // There was a gap in the sequence since we last heard from the storage.
                // This can happen from normal gaps in the sequence (from document edits)
                // or possibly if we have a flaky network connection between us and the storage.
                // We have to call catchUp() whether or not the doc is interesting, because we
                // don't know what happened in the gap.
                logger.debug('this follower needs to catch up.  calling catchUp()');
                await this._catchUp();
            }
        }, { mode: 'blocking' });

    }

    /**
     * Call this function and await it when you create a QueryFollower.
     * It gives it time to catch up with the Storage.
     */
    async hatch(): Promise<void> {
        logger.debug('hatching...');
        await this._catchUp();
        logger.debug('...done hatching.');
    }

    /**
     * Is this query follower all caught up with the latest
     * changes from the Storage?
     */
    isCaughtUp(): boolean {
        return this._maxLocalIndex >= this.storage.getMaxLocalIndex();
    }

    async _catchUp(): Promise<void> {
        // Process everything until we're caught up with the storage.
        // This blocks until we're caught up.

        if (this.isClosed()) { logger.debug(`stopping catch-up because we're closed`); return; }

        if (this.isCaughtUp()) {
            logger.debug('_catchUp(): no catch-up needed, we match or exceed the storageDriver\'s local index');
            logger.debug('...sending caught-up event');
            await this.bus.sendAndWait('caught-up');
            logger.debug('...done sending caught-up event');
            return;
        }

        if (this.isClosed()) { logger.debug(`stopping catch-up because we're closed`); return; }

        // get a batch of docs to process
        logger.debug('_catchUp(): this follower fell behind');
        logger.debug('...querying for a batch of docs we missed...');
        // TODO: this will include our query filters, and we won't see docs filtered out by the query.
        // That means we won't naturally update our maxLocalIndex as high as it might go.
        // So let's get the storage's localIndex now, and remember it (just before doing the query,
        // so we won't have any gaps...)
        let storageMaxLocalIndex = this.storage.storageDriver.getMaxLocalIndex();

        // Do the query...
        let catchUpDocs = await this.storage.queryDocs({
            ...this._query,
            startAfter: { localIndex: this._maxLocalIndex },
            limit: 400,  // TODO: what's the right batch size to use?
        });

        // If we got zero docs, we're caught up for now
        if (catchUpDocs.length === 0) {
            // Batch of docs was empty, which means we're caught up.
            // Note that if there are new docs we've filtered out, we will still
            //  be caught up but this.isCaughtUp() will return false because it's comparing
            //  localIndex numbers between us and the storage.

            logger.debug(`...got zero docs, so we're done now`);

            // Update our localIndex to match the saved number from the storage
            // in case the query filter made us skip over a bunch of docs
            this._maxLocalIndex = Math.max(this._maxLocalIndex, storageMaxLocalIndex);

            logger.debug('...sending caught-up event');
            await this.bus.sendAndWait('caught-up');
            logger.debug('...done sending caught-up event');
            return;
        }

        // Process the docs we got...
        logger.debug(`...running callbacks to catch up on ${catchUpDocs.length} docs, blockingly...`);
        for (let d of catchUpDocs) {
            // check frequently if we're closed so we can skip out of a long batch of docs to process
            if (this.isClosed()) { logger.debug(`stopping catch-up because we're closed`); return; }
            if (d._localIndex !== undefined) { this._maxLocalIndex = d._localIndex; }
            await this._cb(d);
        }

        // Update our localIndex to match the saved number from the storage
        // in case the query filter made us skip over a bunch of docs
        this._maxLocalIndex = Math.max(this._maxLocalIndex, storageMaxLocalIndex);

        // Run _catchUp again in case more docs appeared in the meantime, or our batch size was not big enough.
        if (this.isClosed()) { logger.debug(`stopping catch-up because we're closed`); return; }
        logger.debug('...done with batch of callbacks.  scheduling another query for the next batch, in case there are more.');
        await this._catchUp(); // TODO: should this be setTimeout to give other things a chance to run? But then we can't await it...
    }

    isClosed(): boolean {
        return this._isClosed;
    }

    /**
     * Shut down the QueryFollower; unhook from the Storage; process no more events.
     * This is permanent.
     * This happens when the storage closes (we've subscribed to storage willClose)
     * and it can also be called manually if you just want to destroy this queryFollower.
     */
    async close(): Promise<void> {
        logger.debug('close()');
        this._isClosed = true;
        await this.bus.sendAndWait('close');
        this.bus.removeAllSubscriptions();
        if (this._unsubIngest !== undefined) { this._unsubIngest(); }
        if (this._unsubClose !== undefined) { this._unsubClose(); }
    }
}
