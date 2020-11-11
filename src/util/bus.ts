import { Thunk } from './types';

type Callback<T> = (t : T) => void | Promise<void>;

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
    _callbacksByChannel: Partial<Record<keyof ChTypes, Set<Callback<any>>>> = {};  // channel --> callback[]
    changeKey : string = '' + Math.random();  // this becomes a new random value with every call to send()
    subscribe<Ch extends keyof ChTypes>(channel: Ch, cb: Callback<ChTypes[Ch]>): Thunk {
        let cbs: Set<Callback<any>>;
        if (this._callbacksByChannel[channel]) {
            cbs = this._callbacksByChannel[channel] as Set<Callback<any>>;
        } else {
            cbs = new Set();
            this._callbacksByChannel[channel] = cbs;
        }
        cbs.add(cb);

        return () => {
            let cbs = this._callbacksByChannel[channel];
            if (cbs !== undefined) {
                cbs.delete(cb);
                if (cbs.size === 0) {
                    delete this._callbacksByChannel[channel];
                }
            }
        }
    }
    async send<Ch extends keyof ChTypes>(channel: Ch, val: ChTypes[Ch]): Promise<void> {
        // note: sending to '*' only calls the '*' callbacks
        this.changeKey = '' + Math.random();
        let cbs: Set<Callback<any>> | undefined = this._callbacksByChannel[channel];
        if (cbs !== undefined) {
            for (let cb of cbs) {
                let result = cb(val);
                if (result instanceof Promise) {
                    await result;
                }
            }
        }
        // also send to '*', unless we've already because channel is explicitly set to '*'
        if (channel !== '*') {
            cbs = this._callbacksByChannel['*'];
            if (cbs !== undefined) {
                for (let cb of cbs) {
                    let result = cb(val);
                    if (result instanceof Promise) {
                        await result;
                    }
                }
            }
        }
    }
    unsubscribeAll() {
        // clear all subscriptions
        this._callbacksByChannel = {};
    }
}
