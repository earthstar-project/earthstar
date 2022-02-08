import { assert } from "./asserts.ts";
import { StorageAsync } from "../storage/storage-async.ts";
import { AuthorKeypair, Doc } from "../util/doc-types.ts";
import { deepEqual, randomId } from "../util/misc.ts";
import { isErr } from "../util/errors.ts";
import { FormatValidatorEs4 } from "../format-validators/format-validator-es4.ts";
import { StorageDriverAsyncMemory } from "../storage/storage-driver-async-memory.ts";

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

export function makeStorage(addr: string) {
    return new StorageAsync(addr, FormatValidatorEs4, new StorageDriverAsyncMemory(addr));
}

export function makeNStorages(addr: string, number: number) {
    return Array.from({ length: number }, () => makeStorage(addr));
}

function stripLocalIndexFromDoc({ _localIndex, ...rest }: Doc) {
    return { ...rest };
}

export function docsAreEquivalent(docsA: Doc[], docsB: Doc[]) {
    if (docsA.length !== docsB.length) {
        return false;
    }

    const aStripped = docsA.map(stripLocalIndexFromDoc);
    const bStripped = docsB.map(stripLocalIndexFromDoc);

    return deepEqual(aStripped, bStripped);
}

export function writeRandomDocs(
    keypair: AuthorKeypair,
    storage: StorageAsync,
    n: number,
): Promise<void[]> {
    const setPromises = Array.from({ length: n }, () => {
        return new Promise<void>((resolve, reject) => {
            storage.set(keypair, {
                content: `${randomId()}`,
                path: `/${randomId()}/${randomId()}.txt`,
                format: "es.4",
            }).then((result) => {
                if (isErr(result)) {
                    reject(result);
                }
                resolve();
            });
        });
    });

    return Promise.all(setPromises);
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

export async function storageHasAllStoragesDocs(
    storageA: StorageAsync,
    storageB: StorageAsync,
): Promise<boolean> {
    const allADocs = await storageA.getAllDocs();
    const allBDocs = await storageB.getAllDocs();

    const strippedADocs = allADocs.map(stripLocalIndexFromDoc);
    const strippedBDocs = allBDocs.map(stripLocalIndexFromDoc);

    const aHasAllB = strippedBDocs.reduce((hasAll, doc) => {
        if (hasAll === false) {
            return hasAll;
        }

        return strippedADocs.find((aDoc) => {
            return deepEqual(doc, aDoc);
        }) !== undefined;
    }, true);

    return aHasAllB;
}
