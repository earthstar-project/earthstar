import {
    SyncOrAsyncCallback
} from './types/utilTypes';
import {
    Doc,
} from './types/docTypes';
import {
    FollowerState,
    IFollower,
    IStorageFrontendAsync
} from './types/storageTypes';
import { HistoryMode } from './types/queryTypes';

import { makeDebug } from './log';
import chalk from 'chalk';
let debug = makeDebug(chalk.magenta('                  [follower]'));


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
    storageFrontend: IStorageFrontendAsync,
    onDoc: SyncOrAsyncCallback<Doc>,
    historyMode: HistoryMode,
    batchSize?: 20,
}
export class Follower implements IFollower {
    _state: FollowerState = 'sleeping';
    _storageFrontend: IStorageFrontendAsync;
    _onDoc: SyncOrAsyncCallback<Doc>;
    _lastProcessedIndex: number = -1;
    _batchSize: number;
    _historyMode: HistoryMode;
    constructor(opts: FollowerOpts) {
        this._storageFrontend = opts.storageFrontend;
        this._onDoc = opts.onDoc;
        this._batchSize = opts.batchSize ?? 20;
        this._historyMode = opts.historyMode,
        // register with the storage.  it will wake us when there's new docs to process.
        debug('constructor: registering with storageFrontend');
        this._storageFrontend.followers.add(this);
    }
    async wake(): Promise<void> {
        debug('wake()');
        if (this._state === 'closed')  { debug('...closed');  return; }  // never run again, if closed
        if (this._state === 'running') { debug('...running'); return; }  // don't run twice at the same time

        // try to get some docs
        debug('    getting docs');
        let docs = await this._storageFrontend.getDocsSinceLocalIndex(this._historyMode, this._lastProcessedIndex, this._batchSize);
        debug(`    got ${docs.length}`);

        // if we got no docs, we've hit the end and we go to sleep.
        // the storage will wake us up later.
        if (docs.length === 0) {
            debug('    going to sleep');
            this._state = 'sleeping';
            return;
        } 

        // ok, we actually have some docs to process.
        debug('    iterating docs in batch');
        for (let doc of docs) {
            // constantly check if we're closed, and if so, stop this batch.
            if (this._state as any === 'closed') { debug('    ...closed'); return; }
            // run our callback and await it, if it's a promise
            debug('    calling callback');
            let maybeProm = this._onDoc(doc);
            if (maybeProm instanceof Promise) {
                debug('    waiting for callback promise to finish...');
                await maybeProm;
                debug('    ...done');
            }
            this._lastProcessedIndex = doc._localIndex as number;
        }

        // keep runnning to do the next batch
        debug('    setTimeout for next wake().  done.');
        setTimeout(this.wake.bind(this), 0);
    }
    close(): void {
        debug('close()');
        this._state = 'closed';
        // unregister from the storage
        debug('    unregistering from storageFrontend');
        this._storageFrontend.followers.delete(this);
    }
}



/*
export let wakeAsyncFollower = (follower: Follower, storage: IStorage) => {
    // This function is called by storage.upsert on async followers that are sleeping,
    //  and on newly added async followers.

    // Change an async follower from 'sleeping' to 'running'
    // It will start work after setImmediate fires.
    // It will continue running until it runs out of docs to process, then go to sleep again.

    if (follower.state !== 'sleeping') { throw new Error('to start, follower should have been already sleeping'); }
    follower.state = 'running';
    setImmediate(() => continueAsyncFollower(follower, storage));
}

export let continueAsyncFollower = async (follower: Follower, storage: IStorage) => {
    // Continue an async follower that's 'running'.
    // This will call itself over and over using setImmediate until it runs out of docs to process,
    //  then it will go to sleep again.
    // If the state was changed to 'quitting' (from the outside), it will stop early.
    //  (That happens when you unsubscribe it from the storage.)

    if (follower.state === 'quitting') { return; }
    if (follower.state === 'sleeping') { throw new Error('to continue, follower should have been already running'); }
    if (follower.nextIndex > storage.highestLocalIndex) {
        // if we run out of docs to process, go to sleep and stop the thread.
        follower.state = 'sleeping';
        return;
    } else {
        // Since we only run every 4ms we only get to run at most 250 times per second,
        // so let's do a batch of work instead of just one doc.
        let docs = storage.getDocsSinceLocalIndex(follower.nextIndex, 40);
        for (let doc of docs) {
            // run the callback one at a time in series, waiting for it to finish each time
            await follower.cb(doc);
        }
        // and schedule ourselves to run again in 4ms
        setImmediate(() => continueAsyncFollower(follower, storage));
    }
}
*/