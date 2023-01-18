// Testing syncing with appetite 'once'

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
  makeOverlappingReplicaTuple,
  replicaAttachmentsAreSynced,
  replicaDocsAreSynced,
  writeRandomDocs,
} from "../test-utils.ts";
import DefaultCryptoDriver from "../../crypto/default_driver.ts";
import { sleep } from "../../util/misc.ts";
import { notErr } from "../../util/errors.ts";

setGlobalCryptoDriver(DefaultCryptoDriver);

// Multiply driver x set scenarios.
const setOverlap = [
  {
    name: "No data in common",
    item: 0,
  },
  {
    name: "Some data in common",
    item: 50,
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

Deno.test("Sync a single document", async (test) => {
  const authorKeypair = await Crypto.generateAuthorKeypair(
    "test",
  ) as AuthorKeypair;

  const shareKeypair = await Crypto.generateShareKeypair(
    "apples",
  ) as ShareKeypair;

  for (const driverScenario of syncDriverScenarios) {
    await test.step({
      name: `Finishes and syncs (${driverScenario.name})`,
      fn: async () => {
        const replicaA = new Replica({
          driver: new ReplicaDriverMemory(shareKeypair.shareAddress),
          shareSecret: shareKeypair.secret,
        });

        const replicaB = new Replica({
          driver: new ReplicaDriverMemory(shareKeypair.shareAddress),
          shareSecret: shareKeypair.secret,
        });

        await replicaA.set(authorKeypair, {
          path: "/test/path",
          text: "Hello",
        });

        const peerA = new Peer();
        peerA.addReplica(replicaA);

        const peerB = new Peer();
        peerB.addReplica(replicaB);

        const syncDriverScenario = driverScenario.item(
          [FormatEs5],
          "once",
        );

        // Initiate sync for each peer using the driver.
        const [syncerA, syncerB] = await syncDriverScenario.setup(peerA, peerB);

        // Check that the sync finishes.
        await Promise.all([syncerA.isDone(), syncerB.isDone()]);

        // Check that all replicas fully synced.

        await syncDriverScenario.teardown();

        assert(
          await replicaDocsAreSynced([replicaA, replicaB]),
          `+a docs are in sync`,
        );

        assert(
          await replicaAttachmentsAreSynced([replicaA, replicaB]),
          `+a attachments are in sync`,
        );

        await replicaA.close(true);
        await replicaB.close(true);
      },
    });
  }
});

Deno.test("Sync a single document (with attachment)", async (test) => {
  const authorKeypair = await Crypto.generateAuthorKeypair(
    "test",
  ) as AuthorKeypair;

  const shareKeypair = await Crypto.generateShareKeypair(
    "apples",
  ) as ShareKeypair;

  for (const driverScenario of syncDriverScenarios) {
    await test.step({
      name: `Finishes and syncs (${driverScenario.name})`,
      fn: async () => {
        const replicaA = new Replica({
          driver: new ReplicaDriverMemory(shareKeypair.shareAddress),
          shareSecret: shareKeypair.secret,
        });

        const replicaB = new Replica({
          driver: new ReplicaDriverMemory(shareKeypair.shareAddress),
          shareSecret: shareKeypair.secret,
        });

        const randomBytes = crypto.getRandomValues(
          new Uint8Array(32 * 32 * 32),
        );

        const multiplicationFactor = 32;

        const bytes = new Uint8Array(
          randomBytes.length * multiplicationFactor,
        );

        for (let i = 0; i < multiplicationFactor - 1; i++) {
          bytes.set(randomBytes, i * randomBytes.length);
        }

        await replicaA.set(authorKeypair, {
          path: "/test/path.txt",
          text: "Hello",
          attachment: bytes,
        });

        const peerA = new Peer();
        peerA.addReplica(replicaA);

        const peerB = new Peer();
        peerB.addReplica(replicaB);

        const syncDriverScenario = driverScenario.item(
          [FormatEs5],
          "once",
        );

        // Initiate sync for each peer using the driver.
        const [syncerA, syncerB] = await syncDriverScenario.setup(peerA, peerB);

        // Check that the sync finishes.
        await Promise.all([syncerA.isDone(), syncerB.isDone()]);

        // Check that all replicas fully synced.

        await syncDriverScenario.teardown();

        assert(
          await replicaDocsAreSynced([replicaA, replicaB]),
          `+a docs are in sync`,
        );

        assert(
          await replicaAttachmentsAreSynced([replicaA, replicaB]),
          `+a attachments are in sync`,
        );

        await replicaA.close(true);
        await replicaB.close(true);
      },
    });
  }
});

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
  name: "Syncing (appetite continuous, multiple peers)",
  // Not sanitising ops / resources because these fail due to Deno not cleaning up websockets as fast as they should be.
  fn: async (test) => {
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
          await sleep(800);

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

// Testing syncing with appetite 'continuous'
Deno.test({
  name: "Syncing (appetite continuous, held replicas change during sync)",
  // Not sanitising ops / resources because these fail due to Deno not cleaning up websockets as fast as they should be.
  fn: async (test) => {
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

    for (const scenario of syncDriverScenarios) {
      await test.step({
        name: `Syncs over time (${scenario.name})`,
        fn: async () => {
          // Create three peers, add one to each.
          const [ra1, ra2] = await makeOverlappingReplicaTuple(
            authorKeypair,
            shareKeypairA,
            50,
            2,
            10,
          );

          const [rb1, rb2] = await makeOverlappingReplicaTuple(
            authorKeypair,
            shareKeypairB,
            50,
            2,
            10,
          );

          const [rc1, rc2] = await makeOverlappingReplicaTuple(
            authorKeypair,
            shareKeypairC,
            50,
            2,
            10,
          );

          const peerA = new Peer();
          peerA.addReplica(ra1);
          peerA.addReplica(rb1);
          peerA.addReplica(rc1);

          const peerB = new Peer();
          peerB.addReplica(ra2);

          const syncDriverScenario1 = scenario.item(
            [FormatEs5],
            "continuous",
          );

          const syncDriverScenario2 = scenario.item(
            [FormatEs5],
            "continuous",
          );

          // Initiate sync for each peer using the driver.
          const [syncerA, syncerB] = await syncDriverScenario1.setup(
            peerA,
            peerB,
          );

          // Check that that things have synced... eventually.
          await sleep(800);

          // +bananas should not sync because peer A removed it before peer B added it.
          peerA.removeReplica(rb1);

          await sleep(200);

          peerB.addReplica(rb2);

          // +coconuts should sync because now both peers have it.
          peerB.addReplica(rc2);

          await sleep(800);

          try {
            syncerA.cancel("Test finished");
            syncerB.cancel("Test finished");
          } catch {
            assert(false, "Cancellation happens without throwing an error");
          }

          // Check that all replicas fully synced.

          await syncDriverScenario1.teardown();
          await syncDriverScenario2.teardown();

          assert(
            await replicaDocsAreSynced([ra1, ra2]),
            `+a docs are in sync`,
          );

          assert(
            await replicaDocsAreSynced([rc1, rc2]),
            `+c docs are in sync`,
          );

          assert(
            await replicaAttachmentsAreSynced([ra1, ra2]),
            `+a attachments are in sync`,
          );

          assert(
            await replicaAttachmentsAreSynced([rc1, rc2]),
            `+c attachments are in sync`,
          );

          assert(
            await replicaDocsAreSynced([rb1, rb2]) === false,
            `+b docs are NOT in sync`,
          );

          assert(
            await replicaAttachmentsAreSynced([rb1, rb2]) === false,
            `+b attachments are NOT in sync`,
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
  },
});

Deno.test("Syncs attachments for docs which were synced in previous sessions", async (test) => {
  const authorKeypair = await Crypto.generateAuthorKeypair(
    "test",
  ) as AuthorKeypair;

  const shareKeypair = await Crypto.generateShareKeypair(
    "apples",
  ) as ShareKeypair;

  for (const driverScenario of syncDriverScenarios) {
    await test.step({
      name: `Finishes and syncs (${driverScenario.name})`,
      fn: async () => {
        const replicaA = new Replica({
          driver: new ReplicaDriverMemory(shareKeypair.shareAddress),
          shareSecret: shareKeypair.secret,
        });

        const replicaB = new Replica({
          driver: new ReplicaDriverMemory(shareKeypair.shareAddress),
          shareSecret: shareKeypair.secret,
        });

        const randomBytes = crypto.getRandomValues(
          new Uint8Array(32 * 32 * 32),
        );

        const multiplicationFactor = 32;

        const bytes = new Uint8Array(
          randomBytes.length * multiplicationFactor,
        );

        for (let i = 0; i < multiplicationFactor - 1; i++) {
          bytes.set(randomBytes, i * randomBytes.length);
        }

        // Create a new document with an attachment
        const newDocRes = await FormatEs5.generateDocument({
          share: shareKeypair.shareAddress,
          config: {
            shareSecret: shareKeypair.secret,
          },
          keypair: authorKeypair,
          timestamp: Date.now() * 1000,
          input: {
            text: "Test attachment",
            attachment: bytes,
            format: "es.5",
            path: "/test-attachment",
          },
        });

        assert(notErr(newDocRes));
        assert(newDocRes.attachment instanceof Uint8Array);

        // Give replica A the doc AND attachment to ingest
        await replicaA.ingest(FormatEs5, newDocRes.doc, "local");
        await replicaA.ingestAttachment(
          FormatEs5,
          newDocRes.doc,
          newDocRes.attachment,
          "local",
        );

        // Only give replica B the doc WITHOUT the attachment
        await replicaB.ingest(FormatEs5, newDocRes.doc, "local");

        const peerA = new Peer();
        peerA.addReplica(replicaA);

        const peerB = new Peer();
        peerB.addReplica(replicaB);

        const syncDriverScenario = driverScenario.item(
          [FormatEs5],
          "once",
        );

        // Initiate sync for each peer using the driver.
        const [syncerA, syncerB] = await syncDriverScenario.setup(peerA, peerB);

        // Check that the sync finishes.
        await Promise.all([syncerA.isDone(), syncerB.isDone()]);

        // Check that all replicas fully synced.

        await syncDriverScenario.teardown();

        assert(
          await replicaDocsAreSynced([replicaA, replicaB]),
          `+a docs are in sync`,
        );

        assert(
          await replicaAttachmentsAreSynced([replicaA, replicaB]),
          `+a attachments are in sync`,
        );

        await replicaA.close(true);
        await replicaB.close(true);
      },
    });
  }
});

Deno.test("Only initiates a single attachment transfer for two documents with the same attachment", async (test) => {
  const authorKeypair = await Crypto.generateAuthorKeypair(
    "test",
  ) as AuthorKeypair;

  const shareKeypair = await Crypto.generateShareKeypair(
    "apples",
  ) as ShareKeypair;

  for (const driverScenario of syncDriverScenarios) {
    await test.step({
      name: `Finishes and syncs (${driverScenario.name})`,
      fn: async () => {
        const replicaA = new Replica({
          driver: new ReplicaDriverMemory(shareKeypair.shareAddress),
          shareSecret: shareKeypair.secret,
        });

        const replicaB = new Replica({
          driver: new ReplicaDriverMemory(shareKeypair.shareAddress),
          shareSecret: shareKeypair.secret,
        });

        const randomBytes = crypto.getRandomValues(
          new Uint8Array(32 * 32 * 32),
        );

        const multiplicationFactor = 32;

        const bytes = new Uint8Array(
          randomBytes.length * multiplicationFactor,
        );

        for (let i = 0; i < multiplicationFactor - 1; i++) {
          bytes.set(randomBytes, i * randomBytes.length);
        }

        await replicaA.set(authorKeypair, {
          path: "/test/path.txt",
          text: "Hello",
          attachment: bytes,
        });

        await replicaA.set(authorKeypair, {
          path: "/test/path2.txt",
          text: "Hello again!",
          attachment: bytes,
        });

        const peerA = new Peer();
        peerA.addReplica(replicaA);

        const peerB = new Peer();
        peerB.addReplica(replicaB);

        const syncDriverScenario = driverScenario.item(
          [FormatEs5],
          "once",
        );

        // Initiate sync for each peer using the driver.
        const [syncerA, syncerB] = await syncDriverScenario.setup(peerA, peerB);

        // Check that the sync finishes.
        await Promise.all([syncerA.isDone(), syncerB.isDone()]);

        // Check that all replicas fully synced.

        await syncDriverScenario.teardown();

        assert(
          await replicaDocsAreSynced([replicaA, replicaB]),
          `+a docs are in sync`,
        );

        assert(
          await replicaAttachmentsAreSynced([replicaA, replicaB]),
          `+a attachments are in sync`,
        );

        await replicaA.close(true);
        await replicaB.close(true);
      },
    });
  }
});
