import { Thunk, TimeoutError } from './types';

type Callback<T> = (t: T) => void | Promise<void>;

export class Emitter<T> {
    /**
     * An Emitter can send "events" (values of type T)
     * which are received by subscriber callbacks.
     */

    /**
     * changeKey becomes a new random string with every call to send(), just
     * before the callbacks are run.
     */
    changeKey: string = '' + Math.random();

    _callbacks: Set<Callback<T>> = new Set();
    _waitingPromises: any[] = [];  // from calls to next()

    subscribe(cb: Callback<T>): Thunk {
        /**
         * Subscribe to events from this Emitter.
         * 
         * If the callback returns a promise (e.g. it's an async function)
         * then it will block emitter.send() until the callback finishes running.
         * 
         * Returns an unsubscribe function; call it to stop this subscription.
         */
        this._callbacks.add(cb);
        return () => { this._callbacks.delete(cb); }
    }
    async send(t: T): Promise<void> {
        /**
         * Send an event.
         * 
         * Returns a promise that resolves once all the callbacks
         * have finished running, even the async ones.
         * 
         * All callbacks will be run synchronously before this function ends.
         * Callbacks that return a promise will be run one at a time, waiting
         * for each one to resolve, and send() will only return when all the
         * subscription callback promises have resolved.
         * 
         * To guarantee that the callbacks are run one at a time,
         * send() must be await'd like "await emitter.send(123)".
         */
        this.changeKey = '' + Math.random();
        for (let cb of this._callbacks) {
            let result = cb(t);
            if (result instanceof Promise) {
                await result;
            }
        }
        for (let resolve of this._waitingPromises) {
            resolve(t);
        }
        this._waitingPromises = [];
    }
    next(timeout?: number): Promise<T> {
        /**
         * When the next event is sent, this promise will resolve with the value that was sent.
         * Use like "let x = await emitter.next();"
         * 
         * If timeout is provided, the promise will reject with a TimeoutError
         * after that many milliseconds.
         * If timeout is omitted, it will wait forever.
         */
        return new Promise<T>((resolve, reject) => {
            this._waitingPromises.push(resolve);
            if (timeout !== undefined) {
                setTimeout(() => reject(new TimeoutError()), timeout);
            }
        });
    }
    unsubscribeAll() {
        /** Remove all subscriptions. */
        this._callbacks.clear();
    }
}

export let subscribeToManyEmitters = <T>(emitters: Emitter<T>[], cb: Callback<T>): Thunk => {
    /**
     * Subscribe a callback that will run when any of the emitters fire an event.
     * Return a function which unsubscribes from all the emitters.
     */
    let unsubs = emitters.map(e => e.subscribe(cb));
    let unsubAll = () => unsubs.forEach(u => u());
    return unsubAll;
}
