import {
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
    NotImplementedError,
} from '../util/errors';
import {
    IStorageAsync,
    IngestEvent,
} from '../storage/storage-types';
import {
    docMatchesFilter,
} from '../query/query';
import {
    IQueryFollower,
    QueryFollowerEvent,
} from './query-follower-types';

//================================================================================

import { Logger } from '../util/log';
let logger = new Logger('QueryFollower', 'redBright');

//================================================================================

export class QueryFollower implements IQueryFollower {
    storage: IStorageAsync;
    bus: Superbus<QueryFollowerEvent>;

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

        this.bus = new Superbus<QueryFollowerEvent>();

        // enforce rules on supported queries
        if (this._query.historyMode !== 'all') { throw new NotImplementedError(`query historyMode must be 'all'`); }
        if (this._query.orderBy !== 'localIndex ASC') { throw new NotImplementedError(`query orderBy must be 'localIndexASC'`); }
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

            logger.debug(`on storage 'ingest' event.  doc._locaIndex: ${doc._localIndex}; overall maxLocalIndex: ${maxLocalIndex}`);
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
