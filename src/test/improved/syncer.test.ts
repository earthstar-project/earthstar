import { assert } from "../asserts.ts";
import { Crypto } from "../../crypto/crypto.ts";
import { AuthorKeypair } from "../../util/doc-types.ts";
import { Peer } from "../../peer/peer.ts";
import { makeNStorages, storagesAreSynced, writeRandomDocs } from "../test-utils.ts";
import testTransportScenarios from "../transport-scenarios/transport-scenarios.ts";
import { TransportTestHelper } from "../test-scenario-types.ts";
import { Syncer } from "../../syncer/syncer.ts";
import { sleep } from "../../util/misc.ts";

// 	On addPeer
//    Did the storages sync?
//  On close
//    Do we leave any hanging async ops?

for (const makeScenario of testTransportScenarios) {
    testSyncer(makeScenario);
}

function testSyncer(
    { name, make }: { name: string; make: (peer: Peer, targetPeer: Peer) => TransportTestHelper },
) {
    Deno.test({
        name: `Syncer + ${name}`,
        fn: async () => {
            const keypairA = await Crypto.generateAuthorKeypair("suzy") as AuthorKeypair;
            const keypairB = await Crypto.generateAuthorKeypair("devy") as AuthorKeypair;

            // Set up Peers and storages
            const peer = new Peer();
            const targetPeer = new Peer();

            const scenario = make(peer, targetPeer);

            const ADDRESS = "+apples.a123";

            const [storage, targetStorage] = makeNStorages(ADDRESS, 2);

            scenario.clientPeer.addStorage(storage);
            scenario.targetPeer.addStorage(targetStorage);

            // Write random docs to each storage
            await writeRandomDocs(keypairA, storage, 10);
            await writeRandomDocs(keypairB, targetStorage, 10);

            // Create Syncers
            const syncer = new Syncer(scenario.clientPeer, () => scenario.clientTransport);
            const otherSyncer = new Syncer(scenario.targetPeer, () => scenario.targetTransport);

            await scenario.connect();

            // Check if everything synced
            await sleep(100);
            assert(await storagesAreSynced([storage, targetStorage]), "storages synced");

            // Write some more random docs
            await writeRandomDocs(keypairB, storage, 10);
            await writeRandomDocs(keypairA, targetStorage, 10);

            // Check if everything synced again
            await sleep(1000);
            assert(await storagesAreSynced([storage, targetStorage]), "storages synced (again)");

            syncer.close();
            otherSyncer.close();
            await storage.close(false);
            await targetStorage.close(false);
            await scenario.teardown();
        },
    });
}
