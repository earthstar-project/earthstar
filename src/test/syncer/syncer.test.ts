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
  writeRandomDocs,
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

async function makeOverlappingReplicaTuple(
  authorKeypair: AuthorKeypair,
  shareKeypair: ShareKeypair,
  overlap: number,
  tupleSize: number,
  docSetSize: number,
) {
  const replicas = makeReplicasForShare(shareKeypair, tupleSize);

  const docSets = await overlappingDocSets(
    authorKeypair,
    shareKeypair,
    overlap,
    docSetSize,
    tupleSize,
  );

  for (let i = 0; i < tupleSize; i++) {
    const replica = replicas[i];
    const set = docSets[i];

    for (const { doc, attachment } of set) {
      await replica.ingest(FormatEs5, doc, "local");

      if (attachment) {
        await replica.ingestAttachment(FormatEs5, doc, attachment, "local");
      }
    }
  }

  return replicas;
}

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

Deno.test("Syncing (appetite 'once')", async (test) => {
  for (const scenario of scenarios) {
    await test.step({
      name: `Finishes and syncs (${scenario.name})`,
      fn: async () => {
        // For each share, create two replicas with specified overlap.
        const [ra1, ra2] = await makeOverlappingReplicaTuple(
          authorKeypair,
          shareKeypairA,
          scenario.subscenarios.overlap,
          2,
          100,
        );
        const [rb1, rb2] = await makeOverlappingReplicaTuple(
          authorKeypair,
          shareKeypairB,
          scenario.subscenarios.overlap,
          2,
          100,
        );
        const [rc1, rc2] = await makeOverlappingReplicaTuple(
          authorKeypair,
          shareKeypairC,
          scenario.subscenarios.overlap,
          2,
          100,
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
        const [syncerA, syncerB] = await syncDriverScenario.setup(peerA, peerB);

        // Check that the sync finishes.
        await Promise.all([syncerA.isDone(), syncerB.isDone()]);

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

  for (const scenario of syncDriverScenarios) {
    await test.step({
      name: `Finishes (both sides have nothing)`,
      fn: async () => {
        const ra1 = new Replica({
          driver: new ReplicaDriverMemory(shareKeypairA.shareAddress),
          shareSecret: shareKeypairA.secret,
        });

        const ra2 = new Replica({
          driver: new ReplicaDriverMemory(shareKeypairA.shareAddress),
          shareSecret: shareKeypairA.secret,
        });

        const peerA = new Peer();
        peerA.addReplica(ra1);

        const peerB = new Peer();
        peerB.addReplica(ra2);

        const syncDriverScenario = scenario.item(
          [FormatEs5],
          "once",
        );

        // Initiate sync for each peer using the driver.
        const [syncerA, syncerB] = await syncDriverScenario.setup(peerA, peerB);

        // Check that the sync finishes.
        await Promise.all([syncerA.isDone(), syncerB.isDone()]);

        await syncDriverScenario.teardown();

        await ra1.close(true);
        await ra2.close(true);
      },
    });

    await test.step({
      name: `Finishes (one side has nothing)`,
      fn: async () => {
        const ra1 = new Replica({
          driver: new ReplicaDriverMemory(shareKeypairA.shareAddress),
          shareSecret: shareKeypairA.secret,
        });

        const ra2 = new Replica({
          driver: new ReplicaDriverMemory(shareKeypairA.shareAddress),
          shareSecret: shareKeypairA.secret,
        });

        await writeRandomDocs(authorKeypair, ra1, 10);

        const peerA = new Peer();
        peerA.addReplica(ra1);

        const peerB = new Peer();
        peerB.addReplica(ra2);

        const syncDriverScenario = scenario.item(
          [FormatEs5],
          "once",
        );

        // Initiate sync for each peer using the driver.
        const [syncerA, syncerB] = await syncDriverScenario.setup(peerA, peerB);

        // Check that the sync finishes.
        await Promise.all([syncerA.isDone(), syncerB.isDone()]);

        await syncDriverScenario.teardown();

        await ra1.close(true);
        await ra2.close(true);
      },
    });

    await test.step({
      name: `Cancels gracefully (${scenario.name})`,
      fn: async () => {
        // For each share, create two replicas with specified overlap.
        const [ra1, ra2] = await makeOverlappingReplicaTuple(
          authorKeypair,
          shareKeypairA,
          100,
          2,
          100,
        );

        // Create two peers, add one to each.

        const peerA = new Peer();
        peerA.addReplica(ra1);

        const peerB = new Peer();
        peerB.addReplica(ra2);

        const syncDriverScenario = scenario.item(
          [FormatEs5],
          "once",
        );

        // Initiate sync for each peer using the driver.
        const [syncerA, syncerB] = await syncDriverScenario.setup(peerA, peerB);

        // Check that the sync finishes.
        try {
          await syncerA.cancel("Testing cancellation");
          await syncerB.cancel("Testing cancellation");
        } catch {
          assert(false, "Cancellation happens without throwing an error");
        }

        // Check that all replicas fully synced.

        await syncDriverScenario.teardown();

        await ra1.close(true);
        await ra2.close(true);
      },
    });
  }
});

// ==========================================

// Testing syncing with appetite 'continuous'

Deno.test({
  name: "Syncing (appetite continuous, multiple peers')",
  // Not sanitising ops / resources because these fail due to Deno not cleaning up websockets as fast as they should be.
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (test) => {
    for (const scenario of scenarios) {
      await test.step({
        name: `Syncs over time (${scenario.name})`,
        fn: async () => {
          // Create three peers, add one to each.
          const [ra1, ra2, ra3] = await makeOverlappingReplicaTuple(
            authorKeypair,
            shareKeypairA,
            scenario.subscenarios.overlap,
            3,
            10,
          );
          const [rb1, rb2, rb3] = await makeOverlappingReplicaTuple(
            authorKeypair,
            shareKeypairB,
            scenario.subscenarios.overlap,
            3,
            10,
          );
          const [rc1, rc2, rc3] = await makeOverlappingReplicaTuple(
            authorKeypair,
            shareKeypairC,
            scenario.subscenarios.overlap,
            3,
            10,
          );

          const peerA = new Peer();
          peerA.addReplica(ra1);
          peerA.addReplica(rb1);
          peerA.addReplica(rc1);

          const peerB = new Peer();
          peerB.addReplica(ra2);
          peerB.addReplica(rb2);
          peerB.addReplica(rc2);

          const peerC = new Peer();
          peerC.addReplica(ra3);
          peerC.addReplica(rb3);
          peerC.addReplica(rc3);

          const syncDriverScenario1 = scenario.subscenarios.syncDriver(
            [FormatEs5],
            "continuous",
          );

          const syncDriverScenario2 = scenario.subscenarios.syncDriver(
            [FormatEs5],
            "continuous",
          );

          // Initiate sync for each peer using the driver.
          const [syncerA, syncerB] = await syncDriverScenario1.setup(
            peerA,
            peerB,
          );

          const [syncerC, syncerD] = await syncDriverScenario2.setup(
            peerB,
            peerC,
          );

          // Writing docs after sync has commenced. This verifies that gossiping works.

          await Promise.all([
            writeRandomDocs(authorKeypair, ra1, 1),
            writeRandomDocs(authorKeypair, rb2, 1),
            writeRandomDocs(authorKeypair, rc1, 1),
            writeRandomDocs(authorKeypair, rb3, 1),
          ]);

          // Check that that things have synced... eventually.
          await new Promise((res) => {
            setTimeout(res, 500);
          });

          try {
            syncerA.cancel("Test finished");
            syncerB.cancel("Test finished");
            syncerC.cancel("Test finished");
            syncerD.cancel("Test finished");
          } catch {
            assert(false, "Cancellation happens without throwing an error");
          }

          // Check that all replicas fully synced.

          await syncDriverScenario1.teardown();
          await syncDriverScenario2.teardown();

          assert(
            await replicaDocsAreSynced([ra1, ra2, ra3]),
            `+a docs are in sync`,
          );
          assert(
            await replicaDocsAreSynced([rb1, rb2, rb3]),
            `+b docs are in sync`,
          );
          assert(
            await replicaDocsAreSynced([rc1, rc2, rc3]),
            `+c docs are in sync`,
          );

          assert(
            await replicaAttachmentsAreSynced([ra1, ra2, ra3]),
            `+a attachments are in sync`,
          );

          assert(
            await replicaAttachmentsAreSynced([rb1, rb2, rb3]),
            `+b attachments are in sync`,
          );
          assert(
            await replicaAttachmentsAreSynced([rc1, rc2, rc3]),
            `+c attachments are in sync`,
          );

          await ra1.close(true);
          await ra2.close(true);
          await rb1.close(true);
          await rb2.close(true);
          await rc1.close(true);
          await rc2.close(true);
          await ra3.close(true);
          await rb3.close(true);
          await rc3.close(true);
        },
      });
    }
  },
});
