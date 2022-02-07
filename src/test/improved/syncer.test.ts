import { assert } from "../asserts.ts";
import { Crypto } from "../../crypto/crypto.ts";
import { AuthorKeypair } from "../../util/doc-types.ts";
import { Peer } from "../../peer/peer.ts";
import { makeNStorages, storagesAreSynced } from "../test-utils.ts";
import { testTransportScenarios } from "../test-scenarios.ts";
import { TransportScenarioLocal } from "../transport-scenarios.ts";
import { Syncer } from "../../syncer/syncer.ts";
import { sleep } from "../../util/misc.ts";

const keypairA = await Crypto.generateAuthorKeypair("suzy") as AuthorKeypair;
const keypairB = await Crypto.generateAuthorKeypair("devy") as AuthorKeypair;

// 	On addPeer
//    Did the storages sync?
//  On close
//    Do we leave any hanging async ops?

for (const scenario of testTransportScenarios) {
    testSyncer(scenario);
}

function testSyncer(Scenario: typeof TransportScenarioLocal) {
    // Set up three peers

    const peer = new Peer();
    const targetPeer = new Peer();

    const scenario = new Scenario(peer, targetPeer);

    Deno.test(`Syncer + ${scenario.name}`, async () => {
        const ADDRESS = "+apples.a123";

        const [storage, targetStorage] = makeNStorages(ADDRESS, 2);

        // Storage A docs

        await storage.set(keypairA, {
            path: "/apples/colours.txt",
            content: "Green, red, yellow",
            format: "es.4",
        });

        await targetStorage.set(keypairB, {
            path: "/apples/tastes.txt",
            content: "Sweet, tart, sour",
            format: "es.4",
        });

        peer.addStorage(storage);
        targetPeer.addStorage(targetStorage);

        const syncer = new Syncer(peer, () => scenario.clientTransport);
        const otherSyncer = new Syncer(targetPeer, () => scenario.targetTransport);
        await scenario.connect();

        await sleep(100);

        assert(await storagesAreSynced([storage, targetStorage]));

        syncer.close();
        otherSyncer.close();
        await storage.close(false);
        await targetStorage.close(false);
        await scenario.teardown();
    });
}
