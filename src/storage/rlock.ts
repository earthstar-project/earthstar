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

type RLockCb<T> = (innerLock: RLock<T>) => Promise<T>;

interface LockQueueItem<T> {
    cb: RLockCb<T>;
    deferred: Deferred<T>;
}

export class RLock<T> {
    _itemQueue: LockQueueItem<T>[] = [];
    _threadIsRunning: boolean = false;

    constructor() { }

    async run(cb: RLockCb<T>): Promise<T> {
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
                let result = await cb(new RLock<T>());  // TODO
                deferred.resolve(result);
            } catch (err) {
                deferred.reject(err);
            }
        }
        this._threadIsRunning = false;
    }
}

/*
let stringMult = (s: string, n: number): string => {
    let x = '';
    for (let ii = 0; ii < n; ii++) {
        x += s;
    }
    return x;
}

let loudSleep = async (n: number, msg: string, indent?: string) => {
    let divisions = 6;
    for (let ii = 0; ii < divisions; ii++) {
        if (ii !== 0) { await sleep(n/divisions); }
        console.log((indent ?? '') + stringMult('.', ii) + msg + stringMult('.', divisions - ii - 1));
    }
}

let main = async () => {
    let log = console.log;
    let lock = new RLock();

    log('main 1');

    let proms = [];
    proms.push(lock.run(async () => {
        await loudSleep(1000, 'A');
        return 'A';
    }));
    proms.push(lock.run(async (innerLock) => {
        await loudSleep(1000, 'B');

        let innerProms = [];
        innerProms.push(innerLock.run(async () => {
            await loudSleep(1000, 'b1', '    ');
            return 1;
        }));
        innerProms.push(innerLock.run(async () => {
            await loudSleep(1000, 'b2', '    ');
            return 2;
        }));
        for (let prom of innerProms) {
            let result = await prom;
            log('    ->', result);
        }

        await loudSleep(1000, 'B');

        return 'B';
    }));
    await sleep(300);
    proms.push(lock.run(async () => {
        await loudSleep(1000, 'C');
        return 'C';
    }));

    for (let prom of proms) {
        let result = await prom;
        log('->', result);
    }

    log('main 2');
}
main();
*/



