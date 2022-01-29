import { assert } from "./asserts.ts";
import { StorageAsync } from "../storage/storage-async.ts";
import { Doc } from "../util/doc-types.ts";
import { deepEqual } from "../util/misc.ts";

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

export function docsAreEquivalent(docsA: Doc[], docsB: Doc[]) {
    if (docsA.length !== docsB.length) {
        return false;
    }

    const stripLocalIndex = ({ _localIndex, ...rest }: Doc) => {
        return { ...rest };
    };

    const aStripped = docsA.map(stripLocalIndex);
    const bStripped = docsB.map(stripLocalIndex);

    return deepEqual(aStripped, bStripped);
}

export async function storagesAreSynced(storages: StorageAsync[]): Promise<boolean> {
    const allDocsSets: Doc[][] = [];

    for await (const storage of storages) {
        const allDocs = await storage.getAllDocs();

        allDocsSets.push(allDocs);
    }

    return allDocsSets.reduce((isSynced, docs, i) => {
        if (i === 0) {
            return isSynced;
        }

        const prevDocs = allDocsSets[i - 1];

        return docsAreEquivalent(prevDocs, docs);
    }, false);
}
