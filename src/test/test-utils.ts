import { assert } from "./asserts.ts";

// for testing unicode
export let snowmanString = "\u2603"; // ☃ \u2603  [0xe2, 0x98, 0x83] -- 3 bytes
export let snowmanBytes = Uint8Array.from([0xe2, 0x98, 0x83]);

export let throws = async (fn: () => Promise<any>, msg: string) => {
    try {
        await fn();
        assert(false, "failed to throw: " + msg);
    } catch (err) {
        assert(true, msg);
    }
};

export let doesNotThrow = async (
    fn: () => Promise<any>,
    msg: string,
) => {
    try {
        await fn();
        assert(true, msg);
    } catch (err) {
        assert(false, "threw but should not have: " + msg);
    }
};
