
// for testing unicode
export let snowmanString = '\u2603';  // ☃ \u2603  [0xe2, 0x98, 0x83] -- 3 bytes
export let snowmanBytes = Uint8Array.from([0xe2, 0x98, 0x83]);

export let throws = async (t: any, fn: () => Promise<any>, msg: string) => {
    try {
        await fn();
        t.ok(false, 'failed to throw: ' + msg);
    } catch (err) {
        t.ok(true, msg);
    }
}

export let doesNotThrow = async (t: any, fn: () => Promise<any>, msg: string) => {
    try {
        await fn();
        t.ok(true, msg);
    } catch (err) {
        t.ok(false, 'threw but should not have: ' + msg);
    }
}
