import { assert, assertEquals } from "../asserts.ts";
import { Peer } from "../../peer/peer.ts";
import {
  makeNReplicas,
  storagesAreSynced,
  writeRandomDocs,
} from "../test-utils.ts";
import { Crypto } from "../../crypto/crypto.ts";
import { AuthorKeypair } from "../../util/doc-types.ts";
import { sleep } from "../../util/misc.ts";
import { PeerSyncScenario } from "../test-scenario-types.ts";
import peerSyncScenarios from "../peer-sync-scenarios/peer-sync-scenarios.ts";

/*
Two scenarios:
	- Syncing with another local peer
	- Syncing with another peer via HTTP
		- Use Opine / Express for this so we can test this in Deno and Node
Check both:
		- Syncs documents successfully
		- Can stop synchronisation with the returned function (add some docs to the other side, check that they didn't make it over)

Overall:
	- Make sure everything is cleaned up after closing.
*/

function testSyncScenario(
  scenario: PeerSyncScenario,
) {
  Deno.test(`Peer.sync, Peer.stopSync + ${scenario.name}`, async (test) => {
    const keypairA = await Crypto.generateAuthorKeypair(
      "suzy",
    ) as AuthorKeypair;

    const ADDRESS_A = "+apples.a123";
    const ADDRESS_B = "+bananas.b234";
    const ADDRESS_C = "+coconuts.c345";

    const storagesATriplet = makeNReplicas(ADDRESS_A, 3);
    const storagesBTriplet = makeNReplicas(ADDRESS_B, 3);
    const storagesCTriplet = makeNReplicas(ADDRESS_C, 3);

    const allStorages = [
      ...storagesATriplet,
      ...storagesBTriplet,
      ...storagesCTriplet,
    ];

    await Promise.all(allStorages.map((storage) => {
      return writeRandomDocs(keypairA, storage, 10);
    }));

    const peer = new Peer();

    const [storageA1] = storagesATriplet;
    const [storageB1] = storagesBTriplet;
    const [storageC1] = storagesCTriplet;

    peer.addReplica(storageA1);
    peer.addReplica(storageB1);
    peer.addReplica(storageC1);

    const helper = scenario.make();

    // Create peers to sync with
    const syncables = await helper.setUpTargetPeers(
      storagesATriplet,
      storagesBTriplet,
      storagesCTriplet,
    );

    // Start syncing with our peer
    const closers = syncables.map((syncable) => {
      return peer.sync(syncable);
    });

    // Wait a sec
    await sleep(3000);

    await test.step({
      name: "Storages synced",
      sanitizeOps: false,
      sanitizeResources: false,
      fn: async () => {
        // Check that everything synced
        const docs = await storagesATriplet[0].getLatestDocs();

        assertEquals(docs.length, 30, "Storage A has 30 docs");

        assert(
          await storagesAreSynced(storagesATriplet),
          `All ${ADDRESS_A} storages synced`,
        );
        assert(
          await storagesAreSynced(storagesBTriplet),
          `All ${ADDRESS_B} storages synced`,
        );
        assert(
          await storagesAreSynced(storagesCTriplet),
          `All ${ADDRESS_C} storages synced`,
        );
      },
    });

    // Write some random docs again

    await Promise.all(allStorages.map((storage) => {
      return writeRandomDocs(keypairA, storage, 10);
    }));

    await sleep(3500);
    await test.step({
      name: "Storages synced (again)",
      sanitizeOps: false,
      sanitizeResources: false,
      fn: async () => {
        // Check that everything synced again
        const docs = await storagesATriplet[0].getLatestDocs();

        assertEquals(docs.length, 60, "Storage A has 60 docs");

        assert(
          await storagesAreSynced(storagesATriplet),
          `All ${ADDRESS_A} storages synced`,
        );
        assert(
          await storagesAreSynced(storagesBTriplet),
          `All ${ADDRESS_B} storages synced`,
        );
        assert(
          await storagesAreSynced(storagesCTriplet),
          `All ${ADDRESS_C} storages synced`,
        );
      },
    });

    // Now close the connections
    closers.forEach((closer) => closer());
    peer.stopSyncing();

    // Add a new storage which won't be synced
    const keypairB = await Crypto.generateAuthorKeypair(
      "tony",
    ) as AuthorKeypair;
    const ADDRESS_D = "+dates.d456";
    const storagesDTriplet = makeNReplicas(ADDRESS_D, 3);
    const writeDocsPromises2 = storagesDTriplet.map((storage) => {
      return writeRandomDocs(keypairB, storage, 10);
    });
    await Promise.all(writeDocsPromises2);

    const [storagesD1] = storagesDTriplet;
    peer.addReplica(storagesD1);

    helper.addNonSyncingStorages(storagesDTriplet);

    // Wait a sec

    await sleep(1000);

    await test.step({
      name: "Storages did not sync after closing connection",
      sanitizeOps: false,
      sanitizeResources: false,
      fn: async () => {
        const areDStoragesSynced = await storagesAreSynced(storagesDTriplet);
        assert(
          areDStoragesSynced === false,
          `All ${ADDRESS_D} storages did NOT sync`,
        );
      },
    });

    await Promise.all(allStorages.map((storage) => {
      return writeRandomDocs(keypairA, storage, 10);
    }));

    await peer.syncUntilCaughtUp(syncables);

    await test.step({
      name: "Storages are synced using syncUntilCaughtUp",
      sanitizeOps: false,
      sanitizeResources: false,
      fn: async () => {
        assert(
          await storagesAreSynced(storagesATriplet),
          `All ${ADDRESS_A} storages synced`,
        );
        assert(
          await storagesAreSynced(storagesBTriplet),
          `All ${ADDRESS_B} storages synced`,
        );
        assert(
          await storagesAreSynced(storagesCTriplet),
          `All ${ADDRESS_C} storages synced`,
        );
      },
    });

    // Wrap up.

    await helper.close();
    const storageClosers = [
      ...storagesATriplet,
      ...storagesBTriplet,
      ...storagesCTriplet,
      ...storagesDTriplet,
    ].map((storage) => storage.close(false));

    await Promise.all(storageClosers);
  });
}

for (const scenario of peerSyncScenarios) {
  testSyncScenario(
    scenario,
  );
}
