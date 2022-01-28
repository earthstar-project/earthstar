import { assertEquals } from "../asserts.ts";
import { StorageAsync } from "../../storage/storage-async.ts";
import { FormatValidatorEs4 } from "../../format-validators/format-validator-es4.ts";
import { StorageDriverAsyncMemory } from "../../storage/storage-driver-async-memory.ts";
import { SyncerLocal } from "../../syncer/syncer-local.ts";
import { Crypto } from "../../crypto/crypto.ts";
import { AuthorKeypair } from "../../util/doc-types.ts";
import { Peer } from "../../peer/peer.ts";

function makeStorage(addr: string) {
    return new StorageAsync(addr, FormatValidatorEs4, new StorageDriverAsyncMemory(addr));
}

function makeThreeStorages(addr: string) {
    return [
        makeStorage(addr),
        makeStorage(addr),
        makeStorage(addr),
    ];
}

const keypairA = await Crypto.generateAuthorKeypair("suzy") as AuthorKeypair;
const keypairB = await Crypto.generateAuthorKeypair("devy") as AuthorKeypair;
const keypairC = await Crypto.generateAuthorKeypair("smee") as AuthorKeypair;

// WHAT I'M TESTING:
// 	On addPeer
//    Do the two peers sync documents as expected?
//  On close
//    Do all the created coordinators close properly?

Deno.test("SyncerLocal", async () => {
    const ADDRESS_A = "+apples.a123";
    const ADDRESS_B = "+bananas.b234";
    const ADDRESS_C = "+coconuts.c345";

    const [storageA1, storageA2, storageA3] = makeThreeStorages(ADDRESS_A);

    // Storage A docs

    await storageA1.set(keypairA, {
        path: "/apples/colours.txt",
        content: "Green, red, yellow",
        format: "es.4",
    });

    await storageA2.set(keypairB, {
        path: "/apples/tastes.txt",
        content: "Sweet, tart, sour",
        format: "es.4",
    });

    await storageA3.set(keypairA, {
        path: "/apples/textures.txt",
        content: "Crisp, juicy, mealy",
        format: "es.4",
    });

    // Set up three peers

    const peer1 = new Peer();
    const peer2 = new Peer();
    const peer3 = new Peer();

    peer1.addStorage(storageA1);
    peer2.addStorage(storageA2);
    peer3.addStorage(storageA3);

    // instantiate a new SyncerLocal with peer1
    // addPeers for the other two

    const syncer = new SyncerLocal(peer1);

    await syncer.addPeer(peer2);

    // check docs
    const storageA1Docs = await storageA1.getAllDocs();
    const storageA2Docs = await storageA2.getAllDocs();

    console.log({ storageA1Docs, storageA2Docs });
});
