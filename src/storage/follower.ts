import {
    SyncOrAsyncCallback
} from './util-types';
import {
    Doc,
} from '../util/doc-types';
import {
    HistoryMode,
 } from './query-types';
import {
    FollowerState,
    IFollower,
    IStorageAsync
} from './storage-types';

//--------------------------------------------------

import { Logger } from '../util/log';
let logger = new Logger('follower', 'magenta');

//================================================================================ 
// EVENTS AND FOLLOWERS

/*
state diagram:

     init     storage can call
       v            v
   [sleeping] --> wake() --> [running] --+
       ^                       |   ^     |  wake() keeps calling itself until
       +-----------------------+   +-----+  it runs out of docs
          go to sleep when no
          more docs to process
   

Any state can transition to [closed] when follower.close()
is called, and it stays there forever.
*/

export interface FollowerOpts {
    storage: IStorageAsync,
    onDoc: SyncOrAsyncCallback<Doc | null>,
    historyMode: HistoryMode,
    batchSize?: number,  // default 20

    // blocking: Block the IStorage set or ingest methods?
    // If blocking is false, the storage can accept a lot of writes and the
    // follower will slowly crawl forward at its own speed until it raeches the end.
    // If blocking is true, the storage won't finish a write operation until the
    // follower's callback has finished running.
    // (No matter this setting, the follower will only run one copy of its callback
    // at a time)
    blocking: boolean,
}

// a shortcut to create a follower, just to make sure you let it hatch.
export let addFollower = async (opts: FollowerOpts): Promise<Follower> => {
    let follower = new Follower(opts);
    await follower.hatch();
    return follower;
}

export class Follower implements IFollower {
    _state: FollowerState = 'sleeping';
    _storage: IStorageAsync;
    _onDoc: SyncOrAsyncCallback<Doc | null>;  // null means idle
    _lastProcessedIndex: number = -1;
    _batchSize: number;
    _historyMode: HistoryMode;
    blocking: boolean;

    _debugTag: string = '';

    constructor(opts: FollowerOpts) {

        // Important:
        // To create a new follower, you must do these two steps:
        //     let myFollower = new Follower({ ... opts ... });
        //     await myFollower.hatch();  // it needs a chance to do some async stuff

        this._storage = opts.storage;
        this._onDoc = opts.onDoc;
        this._batchSize = opts.batchSize ?? 20;
        this._historyMode = opts.historyMode,
        this.blocking = opts.blocking ?? false;
        this._debugTag = this.blocking ? 'blocking' : 'lazy';

        // Register with the storage.  it will wake us when there's new docs to process.
        logger.debug(this._debugTag, 'constructor: registering with storage');
        this._storage._followers.add(this);

        // TODO: when adding a follower, it needs to wake up by default
        // so it can catch up, in case it started at zero.
        // Blocking followers also need to put a hold on the IStorage until they've caught up.
        // Maybe followers need a waitUntilCaughtUp method?
    }

    async hatch(): Promise<void> {
        logger.debug(this._debugTag, 'hatching...');
        // Wake up the follower for the first time.
        // This should be called just after instantiating it.
        if (this.blocking) {
            // TODO:  This needs to put a hold on the whole IStorage so nothing can write
            //  until it's caught up
            // Maybe we can grab the lock from the storage and hold it until the follower
            //  is caught up.
            logger.debug(this._debugTag, '    waking up follower now and waiting for it to catch up:');
            logger.debug(this._debugTag, '    TODO: this needs to put a hold on the Storage until it\'s done');
            await this.wake();
            logger.debug(this._debugTag, '    ...done waking up follower');
        } else {
            // lazy followers wake up later
            logger.debug(this._debugTag, '    scheduled to wake up later.');
            setTimeout(this.wake.bind(this), 0);
        }
        logger.debug(this._debugTag, '    ...done hatching');
        logger.debug(this._debugTag, '    ...resolving hatchPromise');
    }

    async wake(): Promise<void> {

        // TODO: for blocking followers, this whole function needs to block
        // until the follower is completely caught up.
        // instead, right now it only runs one batch and then schedules another one recursively
        // which works but can hit a stack overflow.

        logger.debug(this._debugTag, 'wake()');
        if (this._state === 'closed')  { logger.debug(this._debugTag, '...closed');  return; }  // never run again, if closed
        if (this._state === 'running') { logger.debug(this._debugTag, '...running'); return; }  // don't run twice at the same time

        // try to get some docs
        logger.debug(this._debugTag, `    getting batch of up to ${this._batchSize} docs`);
        let docs = await this._storage.getDocsSinceLocalIndex(this._historyMode, this._lastProcessedIndex + 1, this._batchSize);
        logger.debug(this._debugTag, `    ...got ${docs.length} doc in this batch query`);

        // process the docs, if we got any
        logger.debug(this._debugTag, `    iterating ${docs.length} docs in batch...`);
        for (let doc of docs) {
            // constantly check if we're closed, and if so, stop this batch.
            if (this._state as any === 'closed') { logger.debug(this._debugTag, '    ...closed'); return; }
            // run our callback and await it, if it's a promise
            logger.debug(this._debugTag, '        calling callback');
            let maybeProm = this._onDoc(doc);
            if (maybeProm instanceof Promise) {
                logger.debug(this._debugTag, '    waiting for callback promise to finish...');
                await maybeProm;
                logger.debug(this._debugTag, '    ...done');
            }
            this._lastProcessedIndex = doc._localIndex as number;
        }
        logger.debug(this._debugTag, '    ...done iterating docs in batch');

        if (docs.length < this._batchSize) {
            // no more docs right now; go to sleep
            logger.debug(this._debugTag, '    that was not a full batch; going to sleep');
            this._state = 'sleeping';
            // announce to our callback that we have become idle
            let maybeProm = this._onDoc(null);
            if (maybeProm instanceof Promise) {
                await maybeProm;
            }
            return;
        } else {
            logger.debug(this._debugTag, '    done with this batch but there\'s more to do.');
            // keep runnning to do the next batch
            if (this.blocking) {
                // TODO: this is a stack overflow waiting to happen, need to do this without recursion
                logger.debug(this._debugTag, '    blocking mode: recursing into next batch and not returning until that one is done.');
                await this.wake();
                logger.debug(this._debugTag, '    ...unwinding call stack');
            } else {
                logger.debug(this._debugTag, '    follower is lazy.  setTimeout for next wake() to get next batch.  done for now.');
                setTimeout(this.wake.bind(this), 0);
            }
        }
    }
    close(): void {
        logger.debug(this._debugTag, 'close()');
        this._state = 'closed';
        // unregister from the storage
        logger.debug(this._debugTag, '    unregistering from storage');
        this._storage._followers.delete(this);
        // TODO: don't tell our callback that we're idle, I guess?
    }
}
