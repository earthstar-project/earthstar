export type Thunk = () => void;
export type Callback<T> = (t : T) => void | Promise<void>;

export class Emitter<T> {
    // Allow subscribing to an event using callbacks.
    // T is the type of event that will be emitted.
    // If the callbacks return promises (are async callbacks),
    // then we will await them here.  In other words, only one
    // callback will run at a time, assuming the event is
    // sent with "await send(...)" and not just "send(...)".
    _callbacks : Callback<T>[] = [];
    constructor() {
    }
    subscribe(cb : Callback<T>) : Thunk {
        this._callbacks.push(cb);
        // return an unsubscribe function
        return () => {
            this._callbacks = this._callbacks.filter(c => c !== cb);
        };
    }
    async send(t : T) : Promise<void> {
        for (let cb of this._callbacks) {
            let result = cb(t);
            if (result instanceof Promise) {
                await result;
            }
        }
    }
}
