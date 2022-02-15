import { assert } from "../asserts.ts";
import { Peer } from "../../peer/peer.ts";
import { makeNStorages, storagesAreSynced, writeRandomDocs } from "../test-utils.ts";
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

// TestContext type not exported to DNT test shims yet: https://github.com/denoland/node_deno_shims/issues/85
type TestFn = Parameters<typeof Deno.test>["1"];
type TestContext = Parameters<TestFn>["0"];

async function testSyncScenario(
    scenario: PeerSyncScenario,
    test: TestContext,
) {
    await test.step(`Peer.sync, Peer.stopSync + ${scenario.name}`, async () => {
        const keypairA = await Crypto.generateAuthorKeypair("suzy") as AuthorKeypair;

        const ADDRESS_A = "+apples.a123";
        const ADDRESS_B = "+bananas.b234";
        const ADDRESS_C = "+coconuts.c345";

        const storagesATriplet = makeNStorages(ADDRESS_A, 3);
        const storagesBTriplet = makeNStorages(ADDRESS_B, 3);
        const storagesCTriplet = makeNStorages(ADDRESS_C, 3);

        const allStorages = [...storagesATriplet, ...storagesBTriplet, ...storagesCTriplet];

        const writeDocsPromises = allStorages.map((storage) => {
            return writeRandomDocs(keypairA, storage, 10);
        });

        await Promise.all(writeDocsPromises);

        const peer = new Peer();

        const [storageA1] = storagesATriplet;
        const [storageB1] = storagesBTriplet;
        const [storageC1] = storagesCTriplet;

        peer.addStorage(storageA1);
        peer.addStorage(storageB1);
        peer.addStorage(storageC1);

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

        // Check that everything synced
        assert(await storagesAreSynced(storagesATriplet), `All ${ADDRESS_A} storages synced`);
        assert(await storagesAreSynced(storagesBTriplet), `All ${ADDRESS_B} storages synced`);
        assert(await storagesAreSynced(storagesCTriplet), `All ${ADDRESS_C} storages synced`);

        // Now close the connections
        closers.forEach((closer) => closer());

        // Add a new storage which won't be synced
        const keypairB = await Crypto.generateAuthorKeypair("tony") as AuthorKeypair;
        const ADDRESS_D = "+dates.d456";
        const storagesDTriplet = makeNStorages(ADDRESS_D, 3);
        const writeDocsPromises2 = storagesDTriplet.map((storage) => {
            return writeRandomDocs(keypairB, storage, 10);
        });
        await Promise.all(writeDocsPromises2);

        const [storagesD1] = storagesDTriplet;
        peer.addStorage(storagesD1);

        helper.addNonSyncingStorages(storagesDTriplet);

        // Wait a sec

        await sleep(1000);

        const areDStoragesSynced = await storagesAreSynced(storagesDTriplet);
        assert(areDStoragesSynced === false, `All ${ADDRESS_D} storages did NOT sync`);

        // Wrap up.

        peer.stopSyncing();
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

Deno.test("Peer sync", async (test) => {
    for (const scenario of peerSyncScenarios) {
        await testSyncScenario(
            scenario,
            test,
        );
    }
});
