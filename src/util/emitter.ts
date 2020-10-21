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
    changeKey : string = 'init';  // this becomes a new random value with every update
    subscribe(cb : Callback<T>) : Thunk {
        this._callbacks.push(cb);
        // return an unsubscribe function
        return () => {
            this._callbacks = this._callbacks.filter(c => c !== cb);
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
        this._callbacks = [];
    }
}

export let subscribeToManyEmitters = <T>(emitters : Emitter<T>[], cb : Callback<T>) : Thunk => {
    // Run the callback when any of the emitters fire.
    // Return a thunk which unsubscribes from all the emitters.
    let unsubs = emitters.map(e => e.subscribe(cb));
    let unsubAll = () => unsubs.forEach(u => u());
    return unsubAll;
}

export class Bus<ChTypes extends Record<string, any>> {
    /*
    Like Emitter, but with multiple channels.
    Each channel has a name (a string) and an allowed message type.

    When you subscribe with a callback, that callback may return a Promise.
    Sending will block until all the callbacks' promises are resolved, e.g. the
    callbacks are done running.
    Remember to "await bus.send" so this blocking will work.
    This purely works at the level of the individual send() call; the overall bus
    instance is not generally blocked.  But it's a useful way to get backpressure
    when sending a lot of events, e.g.

        let manyThings = [......];
        for (let thing of manyThings) {
            // this will slowly progress through the things,
            // running the callbacks one at a time
            // instead of launching them all at once
            await bus.send('channel1', thing);
        }
        // at this point all the callbacks are done running

    Usage:

        interface ChannelTypes {
            ch1: string,
            ch2: number,
        }
        let bus = new Bus<ChannelTypes>();

        // subscribe some callbacks
        let unsub1 = bus.subscribe('ch1', async (s: string) => {
            console.log('async callback that blocks until done...');
            await sleep(1000);
            console.log('...done');
        });
        let unsub2 bus.subscribe('ch1', (s: string) => {
            console.log('sync callbacks also work');
            console.log(s);
        });

        // sending will block until the callbacks are done running
        await bus.send('ch1', 'hello');

        unsub1();
        unsub2();
    
    You can also subscribe to the special '*' channel which gets every event from every channel.
    However to use it you have to declare '*' in your channel type interface and manually set
    what type it's expected to produce, which would be a union of the other types.

        interface ChannelTypesWithStar {
            ch1: string,
            ch2: number,
            '*': string | number,
        }
        let bus = new Bus<ChannelTypesWithStar>();
        bus.subscribe('*', x => { });  // x will be string | number

    You wouldn't normally do this, but if you send events to the '*' channel 
    they are only caught by the '*' callbacks.

    Callbacks are run in the same order they were subscribed, except that
    the special '*' callbacks are run after the others.

    */
    _callbacksByChannel: Partial<Record<keyof ChTypes, Callback<any>[]>> = {};  // channel --> callback[]
    changeKey : string = 'init';  // this becomes a new random value with every call to send()
    subscribe<Ch extends keyof ChTypes>(channel: Ch, cb: Callback<ChTypes[Ch]>): Thunk {
        let existingCbs: Callback<any>[] | undefined = this._callbacksByChannel[channel];
        let cbs: Callback<any>[] = existingCbs || [];
        cbs.push(cb);
        this._callbacksByChannel[channel] = cbs;
        return () => {
            let cbs: Callback<any>[] | undefined = this._callbacksByChannel[channel];
            if (cbs !== undefined) {
                cbs = cbs.filter((c: any) => c !== cb);
                if (cbs.length === 0) {
                    delete this._callbacksByChannel[channel];
                } else {
                    this._callbacksByChannel[channel] = cbs;
                }
            }
        }
    }
    async send<Ch extends keyof ChTypes>(channel: Ch, val: ChTypes[Ch]): Promise<void> {
        this.changeKey = '' + Math.random();

        // TODO: if sending to '*', should we call every single callback?
        // for now we only call the '*' callbacks

        // gather the callbacks to call
        // regular events send to their own channel's subscribers plus '*' subscribers
        let cbs: Callback<any>[] = [];
        cbs = cbs.concat((this._callbacksByChannel[channel] as Callback<any>[] | undefined) || []);
        cbs = cbs.concat((this._callbacksByChannel['*'] as Callback<any>[] | undefined) || []);

        // call them
        for (let cb of cbs) {
            let result = cb(val);
            if (result instanceof Promise) {
                await result;
            }
        }
    }
    unsubscribeAll() {
        // clear all subscriptions
        this._callbacksByChannel = {};
    }
}
