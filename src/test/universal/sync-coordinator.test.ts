//import { FakeTime } from "https://deno.land/x/mock@0.12.2/mod.ts";
import { assert, assertEquals } from "../asserts.ts";
import { Rpc } from "../test-deps.ts";
import { Peer } from "../../peer/peer.ts";
import { Crypto } from "../../crypto/crypto.ts";
import { AuthorKeypair } from "../../util/doc-types.ts";
import { SyncCoordinator } from "../../syncer/sync-coordinator.ts";
import { makeSyncerBag } from "../../syncer/_syncer-bag.ts";
import {
  makeNReplicas,
  storageHasAllStoragesDocs,
  writeRandomDocs,
} from "../test-utils.ts";
import { sleep } from "../../util/misc.ts";

// after start()
//   does it determine the common shares?
//   does it determine the partner's peerId?
//   has the peer acquired the other peer's docs?

// after pullDocs
//   have the expect docs been ingested?

// after close()
//   Does it leave hanging ops?

Deno.test("SyncCoordinator", async () => {
  //const time = new FakeTime();

  // Set up two peers with two shares in common
  // And different sets of docs.
  const keypairA = await Crypto.generateAuthorKeypair("suzy") as AuthorKeypair;
  const keypairB = await Crypto.generateAuthorKeypair("devy") as AuthorKeypair;

  const ADDRESS_A = "+apples.a123";
  const ADDRESS_B = "+bananas.b234";
  const ADDRESS_C = "+coconuts.c345";
  const ADDRESS_D = "+dates.d456";

  const [storageA1, storageA2] = makeNReplicas(ADDRESS_A, 2);
  const [storageB1] = makeNReplicas(ADDRESS_B, 1);
  const [storageC1, storageC2] = makeNReplicas(ADDRESS_C, 2);
  const [storageD1, storageD2] = makeNReplicas(ADDRESS_D, 2);

  const peer = new Peer();
  const targetPeer = new Peer();

  await peer.addReplica(storageA1);
  await peer.addReplica(storageB1);
  await peer.addReplica(storageD1);

  await targetPeer.addReplica(storageA2);
  await targetPeer.addReplica(storageC2);
  await targetPeer.addReplica(storageD2);

  // Write some docs to the same path so that we test all history being synced.
  await storageA1.set(keypairA, {
    content: "Written by A",
    path: "/popular-path",
    format: "es.4",
  });
  await storageA2.set(keypairB, {
    content: "Written by B",
    path: "/popular-path",
    format: "es.4",
  });
  await storageD1.set(keypairA, {
    content: "Written by A",
    path: "/popular-path",
    format: "es.4",
  });
  await storageD2.set(keypairB, {
    content: "Written by B",
    path: "/popular-path",
    format: "es.4",
  });

  // And a bunch more for good measure.
  await writeRandomDocs(keypairA, storageA1, 10);
  await writeRandomDocs(keypairB, storageA2, 10);
  await writeRandomDocs(keypairA, storageD1, 10);
  await writeRandomDocs(keypairB, storageD2, 10);

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

  await sleep(500);

  assertEquals(coordinator.commonShares, [ADDRESS_A, ADDRESS_D]);
  const storageADocs = await storageA1.getAllDocs();
  const storageDDocs = await storageD1.getAllDocs();

  assertEquals(storageADocs.length, 22, "Storage A1 contains 22 docs");
  assertEquals(storageDDocs.length, 22, "Storage D1 contains 22 docs");
  assert(
    await storageHasAllStoragesDocs(storageA1, storageA2),
    `${ADDRESS_A} storages are synced.`,
  );
  assert(
    await storageHasAllStoragesDocs(storageD1, storageD2),
    `${ADDRESS_D} storages are synced.`,
  );

  const applesSyncStatus = coordinator.syncStatuses.get(ADDRESS_A);
  const datesSyncStatus = coordinator.syncStatuses.get(ADDRESS_D);

  assert(applesSyncStatus?.isCaughtUp);
  assert(datesSyncStatus?.isCaughtUp);
  assertEquals(applesSyncStatus.ingestedCount, 11);
  assertEquals(datesSyncStatus.ingestedCount, 11);

  await writeRandomDocs(keypairB, storageA2, 10);
  await writeRandomDocs(keypairB, storageD2, 10);

  await sleep(1000);

  const storageADocsAgain = await storageA1.getAllDocs();
  const storageDDocsAgain = await storageD1.getAllDocs();

  assertEquals(storageADocsAgain.length, 32, "Storage A1 contains 32 docs");
  assertEquals(storageDDocsAgain.length, 32, "Storage D1 contains 32 docs");

  assert(
    await storageHasAllStoragesDocs(storageA1, storageA2),
    `${ADDRESS_A} storages are synced (again).`,
  );
  assert(
    await storageHasAllStoragesDocs(storageD1, storageD2),
    `${ADDRESS_D} storages are synced (again).`,
  );

  // Test addition of new replicas.
  await writeRandomDocs(keypairA, storageC1, 10);
  await writeRandomDocs(keypairB, storageC2, 10);

  await peer.addReplica(storageC1);

  await sleep(1000);

  assert(
    coordinator.commonShares.includes(ADDRESS_C),
    `Common shares now inlududes ${ADDRESS_C}`,
  );

  assert(
    await storageHasAllStoragesDocs(storageC1, storageC2),
    `${ADDRESS_C} storages are synced.`,
  );

  assertEquals(Array.from(coordinator.syncStatuses.entries()), [
    ["+apples.a123", {
      ingestedCount: 21,
      pulledCount: 31,
      isCaughtUp: true,
      partnerIsCaughtUp: false,
    }],
    ["+dates.d456", {
      ingestedCount: 21,
      pulledCount: 21,
      isCaughtUp: true,
      partnerIsCaughtUp: false,
    }],
    ["+coconuts.c345", {
      ingestedCount: 10,
      pulledCount: 10,
      isCaughtUp: true,
      partnerIsCaughtUp: false,
    }],
  ], "Sync status map is correct after initial sync");

  // Close up

  for (
    const replica of [
      storageA1,
      storageA2,
      storageB1,
      storageC1,
      storageC2,
      storageD1,
      storageD2,
    ]
  ) {
    await replica.close(true);
  }

  coordinator.close();
  localTransport.close();
  targetTransport.close();
});
