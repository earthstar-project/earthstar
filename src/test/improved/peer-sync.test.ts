import { assert } from "../asserts.ts";
import { Peer } from "../../peer/peer.ts";
import { makeNStorages, storagesAreSynced, writeRandomDocs } from "../test-utils.ts";
import { Crypto } from "../../crypto/crypto.ts";
import { AuthorKeypair } from "../../util/doc-types.ts";
import { StorageAsync } from "../../storage/storage-async.ts";
import { sleep } from "../../util/misc.ts";

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

type Syncable = Peer | string;

interface PeerSyncScenario {
    name: string;
    setUpTargetPeers(
        aStorages: StorageAsync[],
        bStorages: StorageAsync[],
        cStorages: StorageAsync[],
    ): Promise<Syncable[]>;
    addNonSyncingStorages(
        dStorages: StorageAsync[],
    ): void;
    close(): Promise<void>;
}

const localPeerScenario: { _peer2: Peer; _peer3: Peer } & PeerSyncScenario = {
    name: "Local peers",
    _peer2: new Peer(),
    _peer3: new Peer(),
    setUpTargetPeers(
        aStorages: StorageAsync[],
        bStorages: StorageAsync[],
        cStorages: StorageAsync[],
    ) {
        const [, storageA2, storageA3] = aStorages;
        const [, storageB2, storageB3] = bStorages;
        const [, storageC2, storageC3] = cStorages;

        this._peer2.addStorage(storageA2);
        this._peer2.addStorage(storageB2);
        this._peer2.addStorage(storageC2);

        this._peer3.addStorage(storageA3);
        this._peer3.addStorage(storageB3);
        this._peer3.addStorage(storageC3);

        return Promise.resolve([this._peer2, this._peer3]);
    },
    addNonSyncingStorages(
        dStorages: StorageAsync[],
    ) {
        const [, storageD2, storageD3] = dStorages;
        this._peer2.addStorage(storageD2);
        this._peer3.addStorage(storageD3);
    },

    close() {
        this._peer2.storages().forEach((storage) => {
            this._peer2.removeStorage(storage);
        });
        this._peer3.storages().forEach((storage) => {
            this._peer3.removeStorage(storage);
        });
        return Promise.resolve();
    },
};

const syncScenarios = [localPeerScenario];

async function testSyncScenario(opts: {
    scenario: PeerSyncScenario;
    test: Deno.TestContext;
}) {
    await opts.test.step(`Peer.sync, Peer.stopSync + ${opts.scenario.name}`, async () => {
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

        // Create peers to sync with
        const syncables = await opts.scenario.setUpTargetPeers(
            storagesATriplet,
            storagesBTriplet,
            storagesCTriplet,
        );

        // Start syncing with our peer
        const closers = syncables.map((syncable) => {
            return peer.sync(syncable);
        });

        // Wait a sec

        await sleep(2000);

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

        opts.scenario.addNonSyncingStorages(storagesDTriplet);

        // Wait a sec

        await sleep(1000);

        const areDStoragesSynced = await storagesAreSynced(storagesDTriplet);
        assert(areDStoragesSynced === false, `All ${ADDRESS_D} storages did NOT sync`);

        // Wrap up.

        peer.stopSyncing();
        await opts.scenario.close();
        const storageClosers = [
            ...storagesATriplet,
            ...storagesBTriplet,
            ...storagesCTriplet,
            ...storagesDTriplet,
        ].map((storage) => storage.close(false));

        await Promise.all(storageClosers);
    });
}

Deno.test("Peer sync helper", async (test) => {
    for (const scenario of syncScenarios) {
        await testSyncScenario({
            scenario,
            test,
        });
    }
});
