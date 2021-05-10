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
     * That promise returns the return value of `cb`, or rejects with
     * any error thrown from `cb`.
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
     * The callback must be an async function.
     * 
     * If you need an easy way to bypass the lock and run your callback
     * in a normal way, pass these opts after the callback: { bypass: true }
     * 
     *     await lock.run(() => {
     *         // your code here
     *     }, { bypass: true });
     * 
     * The callback is not started instantly; it's deferred to later in the
     * current tick, or even more if there are other callbacks in the queue.
     * Even with bypass mode, it's run using queueMicrotask.
     * 
     * (Note: Separate instances of `Lock` are independent and don't affect
     *  each other.)
     */
    async run(cb: LockCb<T>, opts?: { bypass?: boolean }): Promise<T> {
        let deferred: Deferred<T> = makeDeferred<T>();

        // a quick easy way to bypass the lock if you want to 
        if (opts?.bypass === true) {
            queueMicrotask(async () => {
                try {
                    deferred.resolve(await cb());
                } catch (err) {
                    deferred.reject(err);
                }
            });
            return deferred.promise;
        }

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
