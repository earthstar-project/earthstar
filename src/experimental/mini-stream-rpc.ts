/*
mini-rpc with streams?
    each function is a stream
    normal functions return [result, END]
    streaming functions return [item, item, KEEPALIVE, item, item, END]
    you need to be able to unsubscribe
    how do functions return values?  maybe they push into a Chan?
*/

import { sleep } from "../util/misc";

class Chan<T> {
    constructor() {
    }
    async send(x: any): Promise<void> {}
    async close(): Promise<void> {}
}
type CbWithChan<T> = (chan: Chan<T>) => Promise<void>;
let makeChan = <T>(cb: CbWithChan<T>): Chan<T> => {
    let chan = new Chan<T>();
    queueMicrotask(() => cb(chan));
    return chan;
};

let fns = {
    // regular sync function
    slowIntegers: async (outChan: Chan<number>): Promise<void> => {
        // when other side unsubscribes, outChan gets closed
        // which causes this to abort
        let ii = 0;
        while (true) {
            await outChan.send(ii);
            await sleep(100);
            ii += 1;
        }
    },
    double: (x: number): number => x * 2,
    doubleSlow: async (outChan: Chan<number>, x: number): Promise<void> => {
        await sleep(123);
        await outChan.send(x * 2);
        await outChan.close();
    },
    doubleSlow2: async (x: number): Promise<Chan<number>> => {
        let chan = new Chan<number>();
        queueMicrotask(async () => {
            await sleep(123);
            await chan.send(x * 2);
            await chan.close();
        });
        return chan;
    },
    doubleSlow3: (x: number): Chan<number> => {
        return makeChan(async (chan) => {
            await sleep(123);
            await chan.send(x * 2);
            await chan.close();
        });
    },
};
