import { FakeTime } from "https://deno.land/x/mock@0.12.2/mod.ts";
import { assert, assertEquals } from "../asserts.ts";
import { Rpc } from "../../../deps.ts";
import { Peer } from "../../peer/peer.ts";
import { Crypto } from "../../crypto/crypto.ts";
import { AuthorKeypair } from "../../util/doc-types.ts";
import { SyncCoordinator } from "../../syncer/sync-coordinator.ts";
import { makeSyncerBag } from "../../syncer/_syncer-bag.ts";
import { makeNStorages, storageHasAllStoragesDocs } from "../test-utils.ts";
import { sleep } from "../../util/misc.ts";

// after start()
//   does it determine the common workspaces?
//   does it determine the partner's peerId?
//   has the peer acquired the other peer's docs?

// after pullDocs
//   have the expect docs been ingested?

// after close()
//   Does it leave hanging ops?

const keypairA = await Crypto.generateAuthorKeypair("suzy") as AuthorKeypair;
const keypairB = await Crypto.generateAuthorKeypair("devy") as AuthorKeypair;

Deno.test("SyncCoordinator", async () => {
    const time = new FakeTime();

    // Set up two peers with two shares in common
    // And different sets of docs.

    const ADDRESS_A = "+apples.a123";
    const ADDRESS_B = "+bananas.b234";
    const ADDRESS_C = "+coconuts.c345";
    const ADDRESS_D = "+dates.d456";

    const [storageA1, storageA2] = makeNStorages(ADDRESS_A, 2);
    const [storageB1] = makeNStorages(ADDRESS_B, 1);
    const [storageC2] = makeNStorages(ADDRESS_C, 1);
    const [storageD1, storageD2] = makeNStorages(ADDRESS_D, 2);

    const peer = new Peer();
    const targetPeer = new Peer();

    peer.addStorage(storageA1);
    peer.addStorage(storageB1);
    peer.addStorage(storageD1);

    targetPeer.addStorage(storageA2);
    targetPeer.addStorage(storageC2);
    targetPeer.addStorage(storageD2);

    await storageA1.set(keypairA, {
        content: "Cider",
        path: "/apples/uses.txt",
        format: "es.4",
    });

    await storageA2.set(keypairB, {
        content: "Pears",
        path: "/apples/similar.txt",
        format: "es.4",
    });

    await storageD1.set(keypairA, {
        content: "Chewy",
        path: "/dates/texture.txt",
        format: "es.4",
    });

    await storageD2.set(keypairB, {
        content: "Sticky",
        path: "/dates/texture.txt",
        format: "es.4",
    });

    // Set up a coordinator with the two peers

    const localTransport = new Rpc.TransportLocal({
        deviceId: peer.peerId,
        description: `Local:${peer.peerId}`,
        methods: makeSyncerBag(peer),
    });

    const targetTransport = new Rpc.TransportLocal({
        deviceId: targetPeer.peerId,
        description: `Local:${targetPeer.peerId}`,
        methods: makeSyncerBag(targetPeer),
    });

    const { thisConn } = localTransport.addConnection(targetTransport);

    const coordinator = new SyncCoordinator(peer, thisConn);

    // Start it up

    await coordinator.start();

    assertEquals(coordinator.commonWorkspaces, [ADDRESS_A, ADDRESS_D]);
    assertEquals(coordinator.partnerPeerId, targetPeer.peerId);
    assert(await storageHasAllStoragesDocs(storageA1, storageA2));
    assert(await storageHasAllStoragesDocs(storageD1, storageD2));

    // How can I check if timers were set up...

    await storageA2.set(keypairB, {
        content: "Bruises easily!",
        path: "/apples/problems.txt",
        format: "es.4",
    });

    // Advance time by 10 seconds
    await time.tickAsync(10000);
    time.restore();
    // Have to do this. Thought the fake time thing would take care of it.
    await sleep(0);
    assert(await storageHasAllStoragesDocs(storageA1, storageA2));

    // Close up

    coordinator.close();
    localTransport.close();
    targetTransport.close();
});
