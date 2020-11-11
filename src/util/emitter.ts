import { Thunk } from './types';

type Callback<T> = (t : T) => void | Promise<void>;

export class Emitter<T> {
    // Allow subscribing to an event using callbacks.
    // T is the type of event that will be emitted.
    // If the callbacks return promises (are async callbacks),
    // then we will await them here.  In other words, only one
    // callback will run at a time, assuming the event is
    // sent with "await send(...)" and not just "send(...)".
    _callbacks : Set<Callback<T>> = new Set();
    changeKey : string = '' + Math.random();  // this becomes a new random value with every call to send()
    subscribe(cb : Callback<T>) : Thunk {
        this._callbacks.add(cb);
        // return an unsubscribe function
        return () => {
            this._callbacks.delete(cb);
        };
    }
    async send(t : T) : Promise<void> {
        this.changeKey = '' + Math.random();
        for (let cb of this._callbacks) {
            let result = cb(t);
            if (result instanceof Promise) {
                await result;
            }
        }
    }
    unsubscribeAll() {
        // clear all subscriptions
        this._callbacks.clear();
    }
}

export let subscribeToManyEmitters = <T>(emitters : Emitter<T>[], cb : Callback<T>) : Thunk => {
    // Run the callback when any of the emitters fire.
    // Return a thunk which unsubscribes from all the emitters.
    let unsubs = emitters.map(e => e.subscribe(cb));
    let unsubAll = () => unsubs.forEach(u => u());
    return unsubAll;
}
