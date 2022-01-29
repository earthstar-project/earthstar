import { assert } from "../asserts.ts";
import { StorageAsync } from "../../storage/storage-async.ts";
import { FormatValidatorEs4 } from "../../format-validators/format-validator-es4.ts";
import { StorageDriverAsyncMemory } from "../../storage/storage-driver-async-memory.ts";
import { SyncerLocal } from "../../syncer/syncer-local.ts";
import { Crypto } from "../../crypto/crypto.ts";
import { AuthorKeypair } from "../../util/doc-types.ts";
import { Peer } from "../../peer/peer.ts";
import { storagesAreSynced } from "../test-utils.ts";

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

// 	On addPeer
//    Did the storages sync?
//  On close
//    Do we leave any hanging async ops?

Deno.test("SyncerLocal", async () => {
    const ADDRESS_A = "+apples.a123";

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

    await storageA3.set(keypairC, {
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

    // Add a peer, verify syncedness

    await syncer.addPeer(peer2);
    assert(await storagesAreSynced([storageA1, storageA2]));

    // add another peer and verify syncedness

    await syncer.addPeer(peer3);
    assert(await storagesAreSynced([storageA1, storageA3]));

    // close everything

    storageA1.close(false);
    storageA2.close(false);
    storageA3.close(false);

    syncer.close();
});
