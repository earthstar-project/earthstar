// Testing syncing with appetite 'once'

import { CryptoDriverSodium } from "../../crypto/crypto-driver-sodium.ts";
import { AuthorKeypair, ShareKeypair } from "../../crypto/crypto-types.ts";
import { Crypto } from "../../crypto/crypto.ts";
import { setGlobalCryptoDriver } from "../../crypto/global-crypto-driver.ts";
import { FormatEs5 } from "../../formats/format_es5.ts";
import { Peer } from "../../peer/peer.ts";
import { ReplicaDriverMemory } from "../../replica/driver_memory.ts";
import { Replica } from "../../replica/replica.ts";

import { assert } from "../asserts.ts";
import { syncDriverScenarios } from "../scenarios/scenarios.ts";
import { MultiplyScenarioOutput, ScenarioItem } from "../scenarios/types.ts";
import { multiplyScenarios } from "../scenarios/utils.ts";
import {
  overlappingDocSets,
  replicaAttachmentsAreSynced,
  replicaDocsAreSynced,
} from "../test-utils.ts";

setGlobalCryptoDriver(CryptoDriverSodium);

// Multiply driver x set scenarios.
const setOverlap = [
  {
    name: "No data in common",
    item: 0,
  },
  {
    name: "A little data in common",
    item: 10,
  },
  {
    name: "Half data in common",
    item: 50,
  },
  {
    name: "Nearly all data in common",
    item: 90,
  },
  {
    name: "All data in common",
    item: 100,
  },
];

const scenarios: MultiplyScenarioOutput<{
  "syncDriver": ScenarioItem<typeof syncDriverScenarios>;
  "overlap": ScenarioItem<typeof setOverlap>;
}> = multiplyScenarios({
  description: "syncDriver",
  scenarios: syncDriverScenarios,
}, {
  description: "overlap",
  scenarios: setOverlap,
});

function makeReplicasForShare(keypair: ShareKeypair, count: number) {
  const replicas = [];

  for (let i = 0; i < count; i++) {
    const replica = new Replica({
      driver: new ReplicaDriverMemory(keypair.shareAddress),
      shareSecret: keypair.secret,
    });

    replicas.push(replica);
  }

  return replicas;
}

async function makeOverlappingDuo(
  authorKeypair: AuthorKeypair,
  shareKeypair: ShareKeypair,
  overlap: number,
) {
  const [a, b] = makeReplicasForShare(shareKeypair, 2);

  const [setA, setB] = await overlappingDocSets(
    authorKeypair,
    shareKeypair,
    overlap,
    100,
  );

  for await (const { doc, attachment } of setA) {
    await a.ingest(FormatEs5, doc, "local");

    if (attachment) {
      await a.ingestAttachment(FormatEs5, doc, attachment, "local");
    }
  }

  for await (const { doc, attachment } of setB) {
    await b.ingest(FormatEs5, doc, "local");

    if (attachment) {
      await b.ingestAttachment(FormatEs5, doc, attachment, "local");
    }
  }

  return [a, b];
}

Deno.test("Syncing (appetite 'once')", async (test) => {
  const authorKeypair = await Crypto.generateAuthorKeypair(
    "test",
  ) as AuthorKeypair;

  // Create three shares
  const shareKeypairA = await Crypto.generateShareKeypair(
    "apples",
  ) as ShareKeypair;
  const shareKeypairB = await Crypto.generateShareKeypair(
    "bananas",
  ) as ShareKeypair;
  const shareKeypairC = await Crypto.generateShareKeypair(
    "coconuts",
  ) as ShareKeypair;

  for (const scenario of scenarios) {
    await test.step({
      name: `Finishes and syncs (${scenario.name})`,
      fn: async () => {
        // For each share, create two replicas with specified overlap.
        const [ra1, ra2] = await makeOverlappingDuo(
          authorKeypair,
          shareKeypairA,
          scenario.subscenarios.overlap,
        );
        const [rb1, rb2] = await makeOverlappingDuo(
          authorKeypair,
          shareKeypairB,
          scenario.subscenarios.overlap,
        );
        const [rc1, rc2] = await makeOverlappingDuo(
          authorKeypair,
          shareKeypairC,
          scenario.subscenarios.overlap,
        );

        // Create two peers, add one to each.

        const peerA = new Peer();
        peerA.addReplica(ra1);
        peerA.addReplica(rb1);
        peerA.addReplica(rc1);

        const peerB = new Peer();
        peerB.addReplica(ra2);
        peerB.addReplica(rb2);
        peerB.addReplica(rc2);

        const syncDriverScenario = scenario.subscenarios.syncDriver(
          [FormatEs5],
          "once",
        );

        // Initiate sync for each peer using the driver.
        const donePromises = await syncDriverScenario.setup(peerA, peerB);

        // Check that the sync finishes.
        await Promise.all(donePromises);

        // Check that all replicas fully synced.

        await syncDriverScenario.teardown();

        assert(await replicaDocsAreSynced([ra1, ra2]), `+a docs are in sync`);
        assert(await replicaDocsAreSynced([rb1, rb2]), `+b docs are in sync`);
        assert(await replicaDocsAreSynced([rc2, rc2]), `+c docs are in sync`);

        assert(
          await replicaAttachmentsAreSynced([ra1, ra2]),
          `+a attachments are in sync`,
        );

        assert(
          await replicaAttachmentsAreSynced([rb1, rb2]),
          `+b attachments are in sync`,
        );
        assert(
          await replicaAttachmentsAreSynced([rc2, rc2]),
          `+c attachments are in sync`,
        );

        await ra1.close(true);
        await ra2.close(true);
        await rb1.close(true);
        await rb2.close(true);
        await rc1.close(true);
        await rc2.close(true);
      },
    });
  }
});

// ==========================================

// Testing syncing with appetite 'continuous'

// Multiply driver x set scenarios

// For each one, check
// That they sync (docs + attachments)
// That they cancel gracefully
// That failure is handled well
