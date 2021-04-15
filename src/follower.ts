import {
    SyncOrAsyncCallback
} from './types/utilTypes';
import {
    Doc,
} from './types/docTypes';
import { HistoryMode } from './types/queryTypes';
import {
    FollowerState,
    IFollower,
    IStorageAsync
} from './types/storageTypes';

import { makeDebug } from './util/log';
import chalk from 'chalk';
let debug = makeDebug(chalk.magentaBright('                  [follower]'));
let debug2 = (blocking: boolean, ...args: any[]) => {
    if (blocking) {
        console.log(chalk.magentaBright('                  [follower (blocking)]'), ...args);
    } else {
        console.log(chalk.magentaBright('                  [follower (lazy)]'), ...args);
    }
}

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

        // Register with the storage.  it will wake us when there's new docs to process.
        debug2(this.blocking, 'constructor: registering with storage');
        this._storage.followers.add(this);

        // TODO: when adding a follower, it needs to wake up by default
        // so it can catch up, in case it started at zero.
        // Blocking followers also need to put a hold on the IStorage until they've caught up.
        // Maybe followers need a waitUntilCaughtUp method?
    }

    async hatch(): Promise<void> {
        debug2(this.blocking, 'hatching...');
        // Wake up the follower for the first time.
        // This should be called just after instantiating it.
        if (this.blocking) {
            // TODO:  This needs to put a hold on the whole IStorage so nothing can write
            //  until it's caught up
            // Maybe we can grab the lock from the storage and hold it until the follower
            //  is caught up.
            debug2(this.blocking, '    waking up follower now and waiting for it to catch up:');
            debug2(this.blocking, '    TODO: this needs to put a hold on the Storage until it\'s done');
            await this.wake();
            debug2(this.blocking, '    ...done waking up follower');
        } else {
            // lazy followers wake up later
            debug2(this.blocking, '    scheduled to wake up later.');
            setTimeout(this.wake.bind(this), 0);
        }
        debug2(this.blocking, '    ...done hatching');
        debug2(this.blocking, '    ...resolving hatchPromise');
    }

    async wake(): Promise<void> {

        // TODO: for blocking followers, this whole function needs to block
        // until the follower is completely caught up.
        // instead, right now it only runs one batch and then schedules another one recursively
        // which works but can hit a stack overflow.

        debug2(this.blocking, 'wake()');
        if (this._state === 'closed')  { debug2(this.blocking, '...closed');  return; }  // never run again, if closed
        if (this._state === 'running') { debug2(this.blocking, '...running'); return; }  // don't run twice at the same time

        // try to get some docs
        debug2(this.blocking, `    getting batch of up to ${this._batchSize} docs`);
        let docs = await this._storage.getDocsSinceLocalIndex(this._historyMode, this._lastProcessedIndex + 1, this._batchSize);
        debug2(this.blocking, `    ...got ${docs.length} doc in this batch query`);

        // process the docs, if we got any
        debug2(this.blocking, `    iterating ${docs.length} docs in batch...`);
        for (let doc of docs) {
            // constantly check if we're closed, and if so, stop this batch.
            if (this._state as any === 'closed') { debug2(this.blocking, '    ...closed'); return; }
            // run our callback and await it, if it's a promise
            debug2(this.blocking, '        calling callback');
            let maybeProm = this._onDoc(doc);
            if (maybeProm instanceof Promise) {
                debug2(this.blocking, '    waiting for callback promise to finish...');
                await maybeProm;
                debug2(this.blocking, '    ...done');
            }
            this._lastProcessedIndex = doc._localIndex as number;
        }
        debug2(this.blocking, '    ...done iterating docs in batch');

        if (docs.length < this._batchSize) {
            // no more docs right now; go to sleep
            debug2(this.blocking, '    that was not a full batch; going to sleep');
            this._state = 'sleeping';
            // announce to our callback that we have become idle
            let maybeProm = this._onDoc(null);
            if (maybeProm instanceof Promise) {
                await maybeProm;
            }
            return;
        } else {
            debug2(this.blocking, '    done with this batch but there\'s more to do.');
            // keep runnning to do the next batch
            if (this.blocking) {
                // TODO: this is a stack overflow waiting to happen, need to do this without recursion
                debug2(this.blocking, '    blocking mode: recursing into next batch and not returning until that one is done.');
                await this.wake();
                debug2(this.blocking, '    ...unwinding call stack');
            } else {
                debug2(this.blocking, '    follower is lazy.  setTimeout for next wake() to get next batch.  done for now.');
                setTimeout(this.wake.bind(this), 0);
            }
        }
    }
    close(): void {
        debug2(this.blocking, 'close()');
        this._state = 'closed';
        // unregister from the storage
        debug2(this.blocking, '    unregistering from storage');
        this._storage.followers.delete(this);
        // TODO: don't tell our callback that we're idle, I guess?
    }
}
