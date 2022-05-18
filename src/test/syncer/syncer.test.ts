// Make a test helper.

import { Crypto } from "../../crypto/crypto.ts";
import { Peer } from "../../peer/peer.ts";
import { Syncer } from "../../syncer/syncer.ts";
import { SyncerDriverLocal } from "../../syncer/syncer_driver_local.ts";
import { AuthorKeypair } from "../../util/doc-types.ts";
import { sleep } from "../../util/misc.ts";
import { assert, assertEquals } from "../asserts.ts";
import {
  makeNReplicas,
  storagesAreSynced,
  writeRandomDocs,
} from "../test-utils.ts";

// Check that replicas are synced at the end.

Deno.test("Syncer", async () => {
  const peerA = new Peer();
  const peerB = new Peer();

  const keypairA = await Crypto.generateAuthorKeypair(
    "suzy",
  ) as AuthorKeypair;

  const ADDRESS_A = "+apples.a123";
  const ADDRESS_B = "+bananas.b234";
  const ADDRESS_C = "+coconuts.c345";

  const storagesADuo = makeNReplicas(ADDRESS_A, 2);
  const storagesBDuo = makeNReplicas(ADDRESS_B, 2);
  const storagesCDuo = makeNReplicas(ADDRESS_C, 2);

  const allStorages = [
    ...storagesADuo,
    ...storagesBDuo,
    ...storagesCDuo,
  ];

  await Promise.all(allStorages.map((storage) => {
    return writeRandomDocs(keypairA, storage, 10);
  }));

  const [a1, a2] = storagesADuo;
  const [b1, b2] = storagesBDuo;
  const [c1, c2] = storagesCDuo;

  peerA.addReplica(a1);
  peerA.addReplica(b1);
  peerA.addReplica(c1);
  peerB.addReplica(a2);
  peerB.addReplica(b2);

  new Syncer({
    peer: peerA,
    driver: new SyncerDriverLocal(peerB, "once"),
    mode: "once",
  });

  await sleep(50);

  assert(await storagesAreSynced([a1, a2]));
  assert(await storagesAreSynced([b1, b2]));
  assert(await storagesAreSynced(storagesCDuo) === false);

  const peerC = new Peer();
  const peerD = new Peer();

  peerC.addReplica(c1);
  peerD.addReplica(c2);

  const syncerToClose = new Syncer({
    peer: peerC,
    driver: new SyncerDriverLocal(peerD, "once"),
    mode: "once",
  });

  let lastStatus = null;

  syncerToClose.onStatusChange((status) => {
    lastStatus = status[ADDRESS_C].status;
    syncerToClose.cancel();
  });

  await sleep(10);

  assertEquals(lastStatus, "aborted");

  await Promise.all(allStorages.map((replica) => replica.close(true)));
});
