import { sleep } from '../util/misc';

export type Resolve<T> = (value: T | PromiseLike<T>) => void;
export type Reject = (reason?: any) => void;

export interface Deferred<T> {
    promise: Promise<T>;
    resolve: Resolve<T>;
    reject: Reject;
}

export let makeDeferred = <T>(): Deferred<T> => {
    let resolve: Resolve<T> = null as any;
    let reject: Reject = null as any;
    let promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

type LockCb<T> = () => Promise<T>;

interface LockQueueItem<T> {
    cb: LockCb<T>;
    deferred: Deferred<T>;
}

export class Lock<T> {
    _itemQueue: LockQueueItem<T>[] = [];
    _threadIsRunning: boolean = false;

    constructor() { }

    /**
     * Each callback given to `lock.run` will be queued up and run one at
     * a time, without overlapping.
     * 
     * When you call `run(cb)`, you get a promise back which resolves
     * after `cb` has eventually gotten to the front of the queue and
     * had a chance to run.
     * 
     * That promise returns the return value of `cb`.
     * 
     * Basic usage, not really proving that the run-callbacks never
     * run in parallel:
     * 
     * ```ts
     *     let lock = new Lock();
     * 
     *     let seven = await lock.run(async () => {
     *         sleep(1000);
     *         return 7;
     *     });
     * ```
     * 
     * (Separate instances of `Lock` are independent and don't affect
     *  each other.)
     */
    async run(cb: LockCb<T>): Promise<T> {
        let deferred: Deferred<T> = makeDeferred<T>();
        this._itemQueue.push({
            cb,
            deferred,
        });
        if (!this._threadIsRunning) {
            this._thread();
        }
        return deferred.promise;
    }

    async _thread() {
        this._threadIsRunning = true;
        while (true) {
            let item = this._itemQueue.shift();
            if (item === undefined) { break; }
            let { cb, deferred } = item;
            await sleep(0);
            try {
                let result = await cb();
                deferred.resolve(result);
            } catch (err) {
                deferred.reject(err);
            }
        }
        this._threadIsRunning = false;
    }
}
