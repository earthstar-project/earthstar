// a Deferred is a Promise with its parts broken apart
// for easy access from the outside.

// normal types for Promise resolve and reject functions
export type ResolveFn<T> = (value: T | PromiseLike<T>) => void;
export type RejectFn = (reason?: any) => void;

export interface Deferred<T> {
    promise: Promise<T>;
    resolve: ResolveFn<T>;
    reject: RejectFn;
}

export let makeDeferred = <T>(): Deferred<T> => {
    let resolve = null as any;
    let reject = null as any;
    let promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};
