import { deferred } from "https://deno.land/std@0.138.0/async/deferred.ts";
import { Crypto } from "../../crypto/crypto.ts";
import { DocEs4, FormatEs4 } from "../../formats/format_es4.ts";
import { BlobDriverMemory } from "../../replica/blob_drivers/memory.ts";
import { Replica } from "../../replica/replica.ts";
import { SyncAgentEvent, SyncAgentStatus } from "../../syncer/syncer_types.ts";
import { SyncAgent } from "../../syncer/sync_agent.ts";
import { AuthorKeypair } from "../../util/doc-types.ts";
import { sleep } from "../../util/misc.ts";
import { assert, assertEquals } from "../asserts.ts";
import { docDriverScenarios } from "../scenarios/scenarios.ts";
import { MultiplyScenarioOutput, ScenarioItem } from "../scenarios/types.ts";
import { multiplyScenarios } from "../scenarios/utils.ts";

const scenarios: MultiplyScenarioOutput<{
  "replicaDriverA": ScenarioItem<typeof docDriverScenarios>;
  "replicaDriverB": ScenarioItem<typeof docDriverScenarios>;
}> = multiplyScenarios({
  description: "replicaDriverA",
  scenarios: docDriverScenarios,
}, {
  description: "replicaDriverB",
  scenarios: docDriverScenarios,
});

const SHARE_ADDR = "+test.a123";

class SyncAgentTestHelper {
  private targetReplica: Replica;
  private sourceReplica: Replica;

  private targetSyncAgent: SyncAgent<[typeof FormatEs4]> | undefined;
  private sourceSyncAgent: SyncAgent<[typeof FormatEs4]> | undefined;

  private isReady = deferred();

  private targetEvents: SyncAgentEvent[] = [];
  private sourceEvents: SyncAgentEvent[] = [];

  constructor(
    { mode, commonDocs, scenario, targetDocs = [], sourceDocs = [] }: {
      mode: "only_existing" | "live";
      commonDocs: DocEs4[];
      scenario: typeof scenarios[number];
      targetDocs?: DocEs4[];
      sourceDocs?: DocEs4[];
    },
  ) {
    this.targetReplica = new Replica({
      driver: {
        docDriver: scenario.subscenarios.replicaDriverA.makeDriver(
          SHARE_ADDR,
          "sync_a",
        ),
        blobDriver: new BlobDriverMemory(),
      },
    });

    this.sourceReplica = new Replica({
      driver: {
        docDriver: scenario.subscenarios.replicaDriverB.makeDriver(
          SHARE_ADDR,
          "sync_b",
        ),
        blobDriver: new BlobDriverMemory(),
      },
    });

    this.ingestDocs("both", commonDocs).then(() => {
      this.ingestDocs("source", sourceDocs).then(() => {
        this.ingestDocs("target", targetDocs).then(() => {
          this.targetSyncAgent = new SyncAgent({
            replica: this.targetReplica,
            mode,
            formats: [FormatEs4],
          });
          this.sourceSyncAgent = new SyncAgent({
            replica: this.sourceReplica,
            mode,
            formats: [FormatEs4],
          });

          const { targetEvents, sourceEvents } = this;

          const [tr1, tr2] = this.targetSyncAgent.readable.tee();
          const [sr1, sr2] = this.sourceSyncAgent.readable.tee();

          tr1.pipeTo(this.sourceSyncAgent.writable);
          sr1.pipeTo(this.targetSyncAgent.writable);

          sr2.pipeTo(
            new WritableStream<SyncAgentEvent>({
              write(entry) {
                sourceEvents.push(entry);
              },
            }),
          );

          tr2.pipeTo(
            new WritableStream<SyncAgentEvent>({
              write(entry) {
                targetEvents.push(entry);
              },
            }),
          );

          this.isReady.resolve(true);
        });
      });
    });
  }

  async ingestDocs(
    where: "target" | "source" | "both",
    docs: DocEs4[],
  ) {
    for (const doc of docs) {
      if (where === "source" || where === "both") {
        await this.sourceReplica.ingest(FormatEs4, doc);
      }

      if (where === "target" || where === "both") {
        await this.targetReplica.ingest(FormatEs4, doc);
      }
    }
  }

  async popEventsFromTarget() {
    await this.isReady;
    return this.targetEvents.splice(0, this.targetEvents.length);
  }

  async popEventsFromSource() {
    await this.isReady;
    return this.sourceEvents.splice(0, this.sourceEvents.length);
  }

  async close() {
    await this.sourceReplica.close(true);
    await this.targetReplica.close(true);
  }

  async statuses() {
    await this.isReady;

    return {
      source: this.sourceSyncAgent?.getStatus(),
      target: this.targetSyncAgent?.getStatus(),
    } as {
      source: SyncAgentStatus;
      target: SyncAgentStatus;
    };
  }

  closeOneSide(side: "target" | "source") {
    if (side === "source") {
      this.sourceSyncAgent?.cancel();
      return;
    }

    return this.targetSyncAgent?.cancel();
  }
}

function generateDoc(keypair: AuthorKeypair, input: {
  path: string;
  content: string;
}) {
  return FormatEs4.generateDocument({
    keypair,
    share: SHARE_ADDR,
    input: {
      format: "es.4",
      path: input.path,
      content: input.content,
    },
    timestamp: Date.now() * 1000,
  });
}

for (const scenario of scenarios) {
  Deno.test(`SyncAgent (in sync + existing only) (${scenario.name})`, async (test) => {
    const keypair = await Crypto.generateAuthorKeypair("test") as AuthorKeypair;

    const { doc: commonDoc } = await generateDoc(keypair, {
      content: "Hello",
      path: "/whatever",
    }) as { doc: DocEs4 };

    const testHelper = new SyncAgentTestHelper(
      {
        mode: "only_existing",
        commonDocs: [commonDoc],
        scenario,
      },
    );

    await test.step("checks hashes and finishes immediately", async () => {
      await sleep(10);

      const targetEvents = await testHelper.popEventsFromTarget();
      const sourceEvents = await testHelper.popEventsFromSource();

      // Each side should have only received two events.
      assertEquals(targetEvents.length, 2);
      assertEquals(sourceEvents.length, 2);

      // The first event on each side should be a HASH event.
      assert(targetEvents[0].kind === "HASH");
      assert(sourceEvents[0].kind === "HASH");

      // They both should have sent the same hash, as they had the same document.
      assertEquals(targetEvents[0].hash, sourceEvents[0].hash);

      // The last event from each side should be a DONE event.
      assert(targetEvents[1].kind === "DONE");
      assert(sourceEvents[1].kind === "DONE");

      const statuses = await testHelper.statuses();

      assertEquals(statuses.source.status, "done");
      assertEquals(statuses.target.status, "done");
    });

    await testHelper.close();
  });

  Deno.test(`SyncAgent (in sync + live) (${scenario.name})`, async (test) => {
    const keypair = await Crypto.generateAuthorKeypair("test") as AuthorKeypair;

    const { doc: commonDoc } = await FormatEs4.generateDocument({
      keypair,
      share: SHARE_ADDR,
      input: {
        format: "es.4",
        path: "/whatever",
        content: "hello",
      },
      timestamp: Date.now() * 1000,
    }) as { doc: DocEs4 };

    const testHelper = new SyncAgentTestHelper({
      mode: "live",
      commonDocs: [commonDoc],
      scenario,
    });

    await test.step("does not existing docs but does sync new ones", async () => {
      await sleep(10);

      const targetEvents = await testHelper.popEventsFromTarget();
      const sourceEvents = await testHelper.popEventsFromSource();

      // Each side should have only received one event.
      assertEquals(targetEvents.length, 1);
      assertEquals(sourceEvents.length, 1);

      // The first event on each side should be a HASH event.
      assert(targetEvents[0].kind === "HASH");
      assert(sourceEvents[0].kind === "HASH");

      // They both should have sent the same hash, as they had the same document.
      assertEquals(targetEvents[0].hash, sourceEvents[0].hash);

      // They both should be idling, waiting for new docs
      const statuses = await testHelper.statuses();

      assertEquals(statuses.source.status, "idling");
      assertEquals(statuses.target.status, "idling");

      // Now the source replica gets a new doc.
      const { doc: newDoc } = await generateDoc(keypair, {
        path: "/whatever2",
        content: "Yo",
      }) as { doc: DocEs4 };

      await testHelper.ingestDocs("source", [newDoc]);

      await sleep(10);

      const targetEvents2 = await testHelper.popEventsFromTarget();
      const sourceEvents2 = await testHelper.popEventsFromSource();

      // Source agent has two events
      assertEquals(sourceEvents2.length, 2);

      // First is a HAVE event for the doc we just ingested.
      assert(sourceEvents2[0].kind === "HAVE");

      // The second one should be a DOC event
      assert(sourceEvents2[1].kind === "DOC");

      assert(sourceEvents2[1].id !== sourceEvents2[0].id);

      // Target agent should have emitted 1 event
      assertEquals(targetEvents.length, 1);

      // It's a WANT event
      assert(targetEvents2[0].kind === "WANT");

      // ... with the same ID as the source agent sent out with its HAVE
      assert(targetEvents2[0].id === sourceEvents2[0].id);

      const statuses2 = await testHelper.statuses();

      assert(statuses2.target.requested === 1);
      assert(statuses2.target.received === 1);

      assert(statuses2.source.requested === 0);
      assert(statuses2.source.received === 0);

      assert(statuses2.target.status === "idling");
      assert(statuses2.source.status === "idling");
    });

    await testHelper.close();
  });

  Deno.test(`SyncAgent (not in sync + existing only) (${scenario.name})`, async (test) => {
    const keypair = await Crypto.generateAuthorKeypair("test") as AuthorKeypair;
    const keypairB = await Crypto.generateAuthorKeypair(
      "suzy",
    ) as AuthorKeypair;

    const { doc: commonDoc } = await generateDoc(keypair, {
      path: "/shared_path",
      content: "Hello",
    }) as { doc: DocEs4 };

    const { doc: onlySourceDoc } = await generateDoc(keypair, {
      path: "/from_source",
      content: "Hi",
    }) as { doc: DocEs4 };

    const { doc: onlyTargetDoc } = await generateDoc(keypairB, {
      path: "/from_target",
      content: "Howdy",
    }) as { doc: DocEs4 };

    const testHelper = new SyncAgentTestHelper(
      {
        mode: "only_existing",
        commonDocs: [commonDoc],
        scenario,
        sourceDocs: [onlySourceDoc],
        targetDocs: [onlyTargetDoc],
      },
    );

    await test.step("syncs existing docs and finishes", async () => {
      await sleep(10);

      const sourceEvents = await testHelper.popEventsFromSource();
      const targetEvents = await testHelper.popEventsFromTarget();
      const statuses = await testHelper.statuses();

      // They should not have matching hashes

      assert(sourceEvents[0].kind === "HASH");
      assert(targetEvents[0].kind === "HASH");
      assert(targetEvents[0].hash !== sourceEvents[0].hash);

      // They both HAVE two docs.

      assert(sourceEvents[1].kind === "HAVE");
      assert(sourceEvents[2].kind === "HAVE");

      assert(targetEvents[1].kind === "HAVE");
      assert(targetEvents[2].kind === "HAVE");

      // They both WANT one doc from each other.

      assert(sourceEvents[3].kind === "WANT");
      assert(sourceEvents[3].id === targetEvents[2].id);

      assert(targetEvents[3].kind === "WANT");
      assert(targetEvents[3].id === sourceEvents[2].id);

      // They both send a DOC to each other

      assert(sourceEvents[4].kind === "DOC");
      assert(sourceEvents[4].id === Object.keys(sourceEvents[2].versions)[0]);

      assert(targetEvents[4].kind === "DOC");
      assert(targetEvents[4].id === Object.keys(targetEvents[2].versions)[0]);

      // They both end with a DONE event.

      assert(sourceEvents[5].kind === "DONE");
      assert(targetEvents[5].kind === "DONE");

      // They have the right status at the end.

      assert(statuses.source.status === "done");
      assert(statuses.target.status === "done");
      assert(statuses.source.requested === 1);
      assert(statuses.source.received === 1);
      assert(statuses.target.requested === 1);
      assert(statuses.target.received === 1);
    });

    await testHelper.close();
  });

  Deno.test(`SyncAgent (not in sync + live) (${scenario.name})`, async (test) => {
    // They both have a HASH event
    // followed by a bunch of HAVEs (what we know each side has)
    // And WANT events for what they don't have
    // And DOC events for what was requested from them
    // And are idling, and have fulfilled all requests

    // Then ingest a new doc in source to make sure it's still going.

    // Make one send a DONE event

    const keypair = await Crypto.generateAuthorKeypair("test") as AuthorKeypair;
    const keypairB = await Crypto.generateAuthorKeypair(
      "suzy",
    ) as AuthorKeypair;

    const { doc: commonDoc } = await generateDoc(keypair, {
      path: "/shared_path",
      content: "Hello",
    }) as { doc: DocEs4 };

    const { doc: onlySourceDoc } = await generateDoc(keypair, {
      path: "/from_source",
      content: "Hi",
    }) as { doc: DocEs4 };

    const { doc: onlyTargetDoc } = await generateDoc(keypairB, {
      path: "/from_target",
      content: "Howdy",
    }) as { doc: DocEs4 };

    const testHelper = new SyncAgentTestHelper({
      mode: "live",
      commonDocs: [commonDoc],
      scenario,
      targetDocs: [onlyTargetDoc],
      sourceDocs: [onlySourceDoc],
    });

    await test.step("syncs existing docs and new ones", async () => {
      await sleep(10);

      const sourceEvents = await testHelper.popEventsFromSource();
      const targetEvents = await testHelper.popEventsFromTarget();
      const statuses = await testHelper.statuses();

      // They should not have matching hashes

      assert(sourceEvents[0].kind === "HASH");
      assert(targetEvents[0].kind === "HASH");
      assert(targetEvents[0].hash !== sourceEvents[0].hash);

      // They both HAVE two docs.

      assert(sourceEvents[1].kind === "HAVE");
      assert(sourceEvents[2].kind === "HAVE");

      assert(targetEvents[1].kind === "HAVE");
      assert(targetEvents[2].kind === "HAVE");

      // They both WANT one doc from each other.

      assert(sourceEvents[3].kind === "WANT");
      assert(sourceEvents[3].id === targetEvents[2].id);

      assert(targetEvents[3].kind === "WANT");
      assert(targetEvents[3].id === sourceEvents[2].id);

      // They both send a DOC to each other

      assert(sourceEvents[4].kind === "DOC");
      assert(sourceEvents[4].id === Object.keys(sourceEvents[2].versions)[0]);

      assert(targetEvents[4].kind === "DOC");
      assert(targetEvents[4].id === Object.keys(targetEvents[2].versions)[0]);

      // They're both idling now.

      assert(statuses.source.status === "idling");
      assert(statuses.target.status === "idling");
      assert(statuses.source.requested === 1);
      assert(statuses.source.received === 1);
      assert(statuses.target.requested === 1);
      assert(statuses.target.received === 1);

      // Send a new doc.

      // Now the source replica gets a new doc.
      const { doc: newDoc } = await generateDoc(keypair, {
        path: "/whatever",
        content: "Yo",
      }) as { doc: DocEs4 };

      await testHelper.ingestDocs("source", [newDoc]);

      const sourceEvents2 = await testHelper.popEventsFromSource();
      const targetEvents2 = await testHelper.popEventsFromTarget();

      assert(sourceEvents2.length === 2);

      assert(sourceEvents2[0].kind === "HAVE");
      assert(sourceEvents2[1].kind === "DOC");
      assert(sourceEvents2[1].id === Object.keys(sourceEvents2[0].versions)[0]);

      assert(targetEvents2.length === 1);
      assert(targetEvents2[0].kind === "WANT");
      assert(targetEvents2[0].id === sourceEvents2[0].id);

      const statuses2 = await testHelper.statuses();

      assert(statuses2.source.status === "idling");
      assert(statuses2.target.status === "idling");
      assert(statuses2.source.requested === 1);
      assert(statuses2.source.received === 1);
      assert(statuses2.target.requested === 2);
      assert(statuses2.target.received === 2);

      // Close one side

      testHelper.closeOneSide("source");

      await sleep(10);

      const statuses3 = await testHelper.statuses();

      const sourceEvents3 = await testHelper.popEventsFromSource();

      assert(statuses3.source.status === "aborted");
      assert(statuses3.target.status === "aborted");

      assert(sourceEvents3[0].kind === "ABORT");
    });

    await testHelper.close();
  });

  // Caught a bug: an agent that doesn't request anything is never done.
  // Test not being done until all wants are fulfilled.
  // Test have/want behaviour
  // Timestamp: agents should only want versions with higher timestamps
  // Versions: agents should only ask for versions they don't have
  // paths: agents should ask for paths they don't know about -- and the replies should have the version IDs, not the root ID
  // Agents should not send back IDs they just received.
  // Test closing a syncagent and making sure it returns DONE
}