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
