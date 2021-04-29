import {
    Query,
 } from './query-types';
import {
    IStorageAsync,
} from './storage-types';

//================================================================================

import { Logger } from '../util/log';
import { Thunk } from './util-types';
import { Doc } from '../util/doc-types';
import { NotImplementedError } from '../util/errors';
let logger = new Logger('QueryFollower', 'redBright');

//================================================================================

export class QueryFollower {
    storage: IStorageAsync;
    query: Query;
    cb: (doc: Doc) => Promise<void>;

    _highestLocalIndex: number = -1;
    _isClosed: boolean = false;

    _unsubIngest: Thunk;
    _unsubClose: Thunk;

    /**
     * When the storage ingests a new doc that matches the given query,
     * call the callback on it.
     * Only some kinds of queries are supported:
     * queries must have these specific settings:
     *      { historyMode: 'all', orderBy: 'localIndexASC' }
     * queries may have:
     *      { startAt: { localIndex: number }}  // to start partway through the sequence
     *      { filter: { ... any filters ... }}  // to filter the docs
     * queries may not have:
     *      { limit: number }  // this doesn't make sense; we process all docs until the end of time (or close())
     */
    // TODO: starting index is... included in the query?
    // TODO: event for becomimg idle or caught up
    // TODO: event for closing
    constructor(storage: IStorageAsync, query: Query, cb: (doc: Doc) => Promise<void>) {
        logger.debug('constructor', query);

        this.storage = storage;
        this.query = query;
        this.cb = cb;

        // enforce rules on supported queries
        if (this.query.historyMode !== 'all') { throw new NotImplementedError(`query  historyMode must be 'all'`); }
        if (this.query.orderBy !== 'localIndex ASC') { throw new NotImplementedError(`query orderBy must be 'localIndexASC'`); }
        if (this.query.limit !== undefined) { throw new NotImplementedError(`query must not have a limit`); }

        if (query.startAt?.localIndex !== undefined) {
            this._highestLocalIndex = query.startAt?.localIndex - 1;
        }
        logger.debug('my _highestLocalIndex is starting at', this._highestLocalIndex);

        // subscribe to storage events
        this._unsubIngest = this.storage.bus.on('ingest', async (channel: string, docIngested: Doc) => {
            logger.debug('on ingest doc with _localIndex:', docIngested._localIndex);
            if (docIngested._localIndex === this._highestLocalIndex + 1) {
                // we've gotten the next doc in the localIndex sequence
                logger.debug('this follower is still caught up.  running callback blockingly...');
                this._highestLocalIndex += 1;
                await this.cb(docIngested);
                logger.debug('...done with callback.');
            } else {
                // we've skipped some; get a batch to catch up
                await this._catchUp();
            }
        }, { mode: 'blocking' });

        // when storage closes, close this QueryFollower too.
        this._unsubClose = this.storage.bus.on('willClose', async () => {
            logger.debug('on willClose, closing blockingly...');
            await this.close();
            logger.debug('...done closing');
        }, { mode: 'blocking' });
    }

    async _catchUp(): Promise<void> {
        if (this._highestLocalIndex >= this.storage.storageDriver.getHighestLocalIndex()) {
            logger.debug('_catchUp(): no catch-up needed, we match or exceed the storageDriver\'s local index');
            return;
        }
        logger.debug('_catchUp(): this follower fell behind');
        logger.debug('...querying for docs we missed...');
        let catchUpDocs = await this.storage.queryDocs({
            ...this.query,
            startAt: { localIndex: this._highestLocalIndex + 1 },
        });
        logger.debug(`...running callbacks to catch up on ${catchUpDocs.length} docs, blockingly...`);
        for (let d of catchUpDocs) {
            if (d._localIndex !== undefined) {
                this._highestLocalIndex = d._localIndex;
            }
            await this.cb(d);
        }
        logger.debug('...done with batch of callbacks.  caught up.');
    }

    async hatch(): Promise<void> {
        logger.debug('hatching...');
        await this._catchUp();
        logger.debug('...done hatching.');
    }

    /**
     * Shut down the QueryFollower; unhook from the Storage; process no more events.
     * This is permanent.
     */
    async close(): Promise<void> {
        logger.debug('close()');
        this._isClosed = true;
        if (this._unsubIngest !== undefined) { this._unsubIngest(); }
        if (this._unsubClose !== undefined) { this._unsubClose(); }
    }
}
