import { assert, assertEquals, assertThrows } from "../asserts.ts";
import { doesNotThrow, throws } from "../test-utils.ts";
import { ShareAddress } from "../../util/doc-types.ts";
import { ReplicaEvent } from "../../replica/replica-types.ts";
import { isErr } from "../../util/errors.ts";
import { microsecondNow, sleep } from "../../util/misc.ts";
import { Crypto } from "../../crypto/crypto.ts";
import {
  GlobalCryptoDriver,
  setGlobalCryptoDriver,
} from "../../crypto/global-crypto-driver.ts";

import { Replica } from "../../replica/replica.ts";

//================================================================================

import { Logger } from "../../util/log.ts";
import { CallbackSink } from "../../streams/stream_utils.ts";
import { MultiplyScenarioOutput, ScenarioItem } from "../scenarios/types.ts";
import {
  blobDriverScenarios,
  cryptoScenarios,
  docDriverScenarios,
} from "../scenarios/scenarios.ts";
import { multiplyScenarios } from "../scenarios/utils.ts";
import { DocEs4, FormatEs4 } from "../../formats/format_es4.ts";
import { streamToBytes } from "../../util/streams.ts";
import { FormatEs5 } from "../../formats/format_es5.ts";

const loggerTest = new Logger("test", "salmon");
const loggerTestCb = new Logger("test cb", "lightsalmon");
//setLogLevel('test', LogLevel.Debug);

//================================================================================

const scenarios: MultiplyScenarioOutput<{
  "docDriver": ScenarioItem<typeof docDriverScenarios>;
  "cryptoDriver": ScenarioItem<typeof cryptoScenarios>;
  "attachmentDriver": ScenarioItem<typeof blobDriverScenarios>;
}> = multiplyScenarios({
  description: "docDriver",
  scenarios: docDriverScenarios,
}, {
  description: "cryptoDriver",
  scenarios: cryptoScenarios,
}, {
  description: "attachmentDriver",
  scenarios: blobDriverScenarios,
});

export function runRelpicaTests(scenario: typeof scenarios[number]) {
  const SUBTEST_NAME = scenario.name;

  setGlobalCryptoDriver(scenario.subscenarios.cryptoDriver);

  function makeReplica(ws: ShareAddress, variant?: string) {
    const driver = scenario.subscenarios.docDriver.makeDriver(ws, variant);
    return new Replica({
      driver: {
        docDriver: driver,
        blobDriver: scenario.subscenarios.attachmentDriver.makeDriver(
          ws,
          variant,
        ),
      },
    });
  }

  Deno.test(
    SUBTEST_NAME + ": replica close() and throwing when closed",
    async () => {
      const initialCryptoDriver = GlobalCryptoDriver;

      const share = "+gardening.abcde";
      const storage = makeReplica(share);
      const events: string[] = [];
      const streamEvents: string[] = [];
      const channelledStreamEvents: string[] = [];

      assertEquals(
        typeof storage.replicaId,
        "string",
        "storage has a storageId",
      );

      // subscribe in a different order than they will normally happen,
      // to make sure they really happen in the right order when they happen for real
      storage.onEvent((event) => {
        if (event.kind === "didClose") {
          loggerTestCb.debug(">> didClose event handler");
          events.push("didClose");
        }
      });

      storage.onEvent((event) => {
        if (event.kind === "willClose") {
          loggerTestCb.debug(">> didClose event handler");
          events.push("willClose");
        }
      });

      // Events

      const eventStream = storage.getEventStream();
      const callbackSink = new CallbackSink<ReplicaEvent<DocEs4>>();
      callbackSink.onWrite((event) => {
        streamEvents.push(event.kind);
      });
      const callbackStream = new WritableStream(callbackSink);
      eventStream.pipeTo(callbackStream);

      // Channelled events

      const channeledEventStream = storage.getEventStream("didClose");
      const channeledCallbackSink = new CallbackSink<ReplicaEvent<DocEs4>>();
      channeledCallbackSink.onWrite((event) => {
        channelledStreamEvents.push(event.kind);
      });
      const channelledCallbackStream = new WritableStream(
        channeledCallbackSink,
      );
      channeledEventStream.pipeTo(channelledCallbackStream);

      // ==================================

      assertEquals(storage.isClosed(), false, "is not initially closed");
      await doesNotThrow(
        async () => storage.isClosed(),
        "isClosed does not throw",
      );

      await doesNotThrow(
        async () => await storage.getAllDocs(),
        "does not throw because not closed",
      );
      await doesNotThrow(
        async () => await storage.getLatestDocs(),
        "does not throw because not closed",
      );
      await doesNotThrow(
        async () => await storage.getAllDocsAtPath("/a"),
        "does not throw because not closed",
      );
      await doesNotThrow(
        async () => await storage.getLatestDocAtPath("/a"),
        "does not throw because not closed",
      );
      await doesNotThrow(
        async () => await storage.queryDocs(),
        "does not throw because not closed",
      );
      assertEquals(events, [], "no events yet");

      loggerTest.debug("launching microtask, nextTick, and setTimeout");
      queueMicrotask(() => loggerTestCb.debug("--- microtask ---"));
      // TODO-DENO: Microtasks work differently — process not available. What to do?
      // process.nextTick(() => loggerTestCb.debug("--- nextTick ---"));
      setTimeout(() => loggerTestCb.debug("--- setTimeout 0 ---"), 0);

      loggerTest.debug("closing...");
      await storage.close(true);
      loggerTest.debug("...done closing");

      // wait for didClose to happen on setTimeout
      await sleep(20);

      assertEquals(
        events,
        ["willClose", "didClose"],
        "closing events happened",
      );

      assertEquals(
        streamEvents,
        ["willClose", "didClose"],
        "closing events (via event stream)",
      );

      assertEquals(
        channelledStreamEvents,
        ["didClose"],
        "closing events happened (via channelled event stream)",
      );

      assertEquals(storage.isClosed(), true, "is closed after close()");

      await doesNotThrow(
        async () => storage.isClosed(),
        "isClosed does not throw",
      );

      await throws(
        async () => await storage.getAllDocs(),
        "throws after closed",
      );
      await throws(
        async () => await storage.getLatestDocs(),
        "throws after closed",
      );
      await throws(
        async () => await storage.getAllDocsAtPath("/a"),
        "throws after closed",
      );
      await throws(
        async () => await storage.getLatestDocAtPath("/a"),
        "throws after closed",
      );
      await throws(
        async () => await storage.queryDocs(),
        "throws after closed",
      );
      await throws(
        async () => storage.getMaxLocalIndex(),
        "throws after closed",
      );
      await throws(
        async () => await storage.set({} as any, {} as any, {} as any),
        "throws after closed",
      );
      await throws(
        async () => await storage.ingest({} as any, {} as any),
        "throws after closed",
      );
      await throws(
        async () =>
          await storage.overwriteAllDocsByAuthor({} as any, {} as any),
        "throws after closed",
      );

      // TODO: skipping set() and ingest() for now

      await throws(
        async () => await storage.close(false),
        "cannot close() twice",
      );
      assertEquals(
        storage.isClosed(),
        true,
        "still closed after calling close() twice",
      );

      assertEquals(
        events,
        ["willClose", "didClose"],
        "no more closing events on second call to close()",
      );

      loggerTest.debug("sleeping 50...");
      await sleep(50);
      loggerTest.debug("...done sleeping 50");

      // storage is already closed
      assertEquals(
        initialCryptoDriver,
        GlobalCryptoDriver,
        `GlobalCryptoDriver has not changed unexpectedly.  started as ${
          (initialCryptoDriver as any).name
        }, ended as ${(GlobalCryptoDriver as any).name}`,
      );
    },
  );

  // TODO: test if erase removes docs (we already tested that it removes config, elsewhere)
  // TODO: test basic writes
  // TODO: test querying

  Deno.test(
    SUBTEST_NAME + ": queryAuthors + queryPaths",
    async (tester) => {
      const initialCryptoDriver = GlobalCryptoDriver;

      const share = "+gardening.abcde";
      const replica = makeReplica(share);

      const keypair1 = await Crypto.generateAuthorKeypair("aaaa");
      const keypair2 = await Crypto.generateAuthorKeypair("bbbb");
      if (isErr(keypair1) || isErr(keypair2)) {
        assert(false, "error making keypair");
      }

      await replica.set(keypair1, {
        path: "/doc.txt",
        content: "content1",
      }, FormatEs4);

      await replica.set(keypair2, {
        path: "/doc2.txt",
        content: "content2",
      }, FormatEs4);

      await replica.set(keypair1, {
        path: "/doc3.txt",
        content: "content3",
      }, FormatEs4);

      await tester.step({
        name: "query authors",
        fn: async () => {
          const authors = await replica.queryAuthors();

          assertEquals(
            authors,
            [keypair1.address, keypair2.address],
            "Returns all authors",
          );

          const authors2 = await replica.queryAuthors({
            filter: {
              path: "/doc2.txt",
            },
          });

          assertEquals(
            authors2,
            [keypair2.address],
            "Returns authors of docs from query",
          );
        },
        sanitizeOps: false,
        sanitizeResources: false,
      });

      await tester.step({
        name: "query paths",
        fn: async () => {
          const paths = await replica.queryPaths();

          assertEquals(
            paths,
            ["/doc.txt", "/doc2.txt", "/doc3.txt"],
            "Returns all paths",
          );

          const paths2 = await replica.queryPaths({
            filter: {
              author: keypair2.address,
            },
          });

          assertEquals(
            paths2,
            ["/doc2.txt"],
            "Returns paths of docs from query",
          );
        },
        sanitizeOps: false,
        sanitizeResources: false,
      });

      await replica.close(true);
    },
  );

  Deno.test(
    SUBTEST_NAME + ": replica overwriteAllDocsByAuthor",
    async () => {
      const initialCryptoDriver = GlobalCryptoDriver;

      const share = "+gardening.abcde";
      const storage = makeReplica(share);

      const keypair1 = await Crypto.generateAuthorKeypair("aaaa");
      const keypair2 = await Crypto.generateAuthorKeypair("bbbb");
      if (isErr(keypair1) || isErr(keypair2)) {
        assert(false, "error making keypair");
      }

      const now = microsecondNow();
      await storage.set(keypair1, {
        path: "/pathA",
        content: "content1",
        timestamp: now,
      }, FormatEs4);
      await storage.set(keypair2, {
        path: "/pathA",
        content: "content2",
        timestamp: now + 3, // latest
      }, FormatEs4);

      await storage.set(keypair2, {
        path: "/pathB",
        content: "content2",
        timestamp: now,
      }, FormatEs4);
      await storage.set(keypair1, {
        path: "/pathB",
        content: "content1",
        timestamp: now + 3, // latest
      }, FormatEs4);

      // history of each path, latest doc first:
      //   /pathA: keypair2, keypair1
      //   /pathB: keypair1, keypair2

      //--------------------------------------------
      // check everything is as expected before we do the overwriteAll

      assertEquals(
        (await storage.getAllDocs()).length,
        4,
        "should have 4 docs including history",
      );
      assertEquals(
        (await storage.getLatestDocs()).length,
        2,
        "should have 2 latest-docs",
      );

      let docsA = await storage.getAllDocsAtPath("/pathA", [FormatEs4]); // latest first
      let docsA_actualAuthorAndContent = docsA.map(
        (doc) => [doc.author, doc.content],
      );
      let docsA_expectedAuthorAndContent: [string, string][] = [
        [keypair2.address, "content2"], // latest first
        [keypair1.address, "content1"],
      ];
      assertEquals(
        docsA.length,
        2,
        "two docs found at /pathA (including history)",
      );
      assert(
        docsA[0].timestamp > docsA[1].timestamp,
        "docs are ordered latest first within this path",
      );
      assertEquals(
        docsA_actualAuthorAndContent,
        docsA_expectedAuthorAndContent,
        "/pathA docs are as expected",
      );

      let docsB = await storage.getAllDocsAtPath("/pathB", [FormatEs4]); // latest first
      let docsB_actualAuthorAndContent = docsB.map(
        (doc) => [doc.author, doc.content],
      );
      let docsB_expectedAuthorAndContent: [string, string][] = [
        [keypair1.address, "content1"], // latest first
        [keypair2.address, "content2"],
      ];
      assertEquals(
        docsB.length,
        2,
        "two docs found at /pathB (including history)",
      );
      assert(
        docsB[0].timestamp > docsB[1].timestamp,
        "docs are ordered latest first within this path",
      );
      assertEquals(
        docsB_actualAuthorAndContent,
        docsB_expectedAuthorAndContent,
        "/pathB docs are as expected",
      );

      //--------------------------------------------
      // overwrite
      const result = await storage.overwriteAllDocsByAuthor(keypair1, [
        FormatEs4,
      ]);
      assertEquals(result, 2, "two docs were overwritten");

      //--------------------------------------------
      // look for results

      assertEquals(
        (await storage.getAllDocs()).length,
        4,
        "after overwriting, should still have 4 docs including history",
      );
      assertEquals(
        (await storage.getLatestDocs()).length,
        2,
        "after overwriting, should still have 2 latest-docs",
      );

      docsA = await storage.getAllDocsAtPath("/pathA", [FormatEs4]); // latest first

      docsA_actualAuthorAndContent = docsA.map(
        (doc) => [doc.author, doc.content],
      );
      docsA_expectedAuthorAndContent = [
        [keypair2.address, "content2"], // latest first
        [keypair1.address, ""],
      ];
      assertEquals(
        docsA.length,
        2,
        "two docs found at /pathA (including history)",
      );
      assert(
        docsA[0].timestamp > docsA[1].timestamp,
        "docs are ordered latest first within this path",
      );
      assertEquals(
        docsA_actualAuthorAndContent,
        docsA_expectedAuthorAndContent,
        "/pathA docs are as expected",
      );

      docsB = await storage.getAllDocsAtPath("/pathB", [FormatEs4]); // latest first
      docsB_actualAuthorAndContent = docsB.map(
        (doc) => [doc.author, doc.content],
      );
      docsB_expectedAuthorAndContent = [
        [keypair1.address, ""], // latest first
        [keypair2.address, "content2"],
      ];
      assertEquals(
        docsB.length,
        2,
        "two docs found at /pathB (including history)",
      );
      assert(
        docsB[0].timestamp > docsB[1].timestamp,
        "docs are ordered latest first within this path",
      );
      assertEquals(
        docsB_actualAuthorAndContent,
        docsB_expectedAuthorAndContent,
        "/pathB docs are as expected",
      );

      await storage.close(true);
      assertEquals(
        initialCryptoDriver,
        GlobalCryptoDriver,
        `GlobalCryptoDriver has not changed unexpectedly.  started as ${
          (initialCryptoDriver as any).name
        }, ended as ${(GlobalCryptoDriver as any).name}`,
      );
    },
  );

  Deno.test(
    SUBTEST_NAME + ": validates addresses",
    async () => {
      const validShare = "+gardening.abcde";
      const invalidShare = "PEANUTS.123";

      assertThrows(() => {
        makeReplica(invalidShare);
      });

      const storage = makeReplica(validShare);
      assert(storage);

      await storage.close(true);
    },
  );

  Deno.test(
    SUBTEST_NAME + ": ingestBlob",
    async () => {
      // Test that a blob is really ingested and can be fetched again.
      const share = "+gardening.abcde";
      const replica = makeReplica(share, "a");
      const replica2 = makeReplica(share, "b");

      const keypair1 = await Crypto.generateAuthorKeypair("aaaa");

      if (isErr(keypair1)) {
        assert(false, "error making keypair");
      }

      const bytes1 = new TextEncoder().encode("Hi!");

      await replica.set(keypair1, {
        text: "Hello",
        path: "/blob.txt",
        blob: bytes1,
      });

      const doc = await replica.getLatestDocAtPath("/blob.txt");

      assert(doc);

      await replica2.ingest(FormatEs5, doc);

      // Test that mismatching doc + blob are rejected

      const mismatchedBytes = new TextEncoder().encode("uhuehuheuh");

      const mismatchedRes = await replica2.ingestBlob(
        FormatEs5,
        doc,
        mismatchedBytes,
      );

      assert(isErr(mismatchedRes));

      // Test that attachment can really be ingested and fetched back again

      const ingestRes = await replica2.ingestBlob(FormatEs5, doc, bytes1);

      assert(!isErr(ingestRes));

      const attachment = await replica2.getBlob(doc);

      assert(!isErr(attachment));
      assert(attachment);

      await streamToBytes(attachment.stream);

      // Is it a problem that we can theoretically provide a document not in the replica?

      // Test that identical bytes are only stored once with ingestBlob.

      const repeatIngestRes = await replica2.ingestBlob(FormatEs5, doc, bytes1);

      assertEquals(repeatIngestRes, false);

      await replica.close(true);
      await replica2.close(true);
    },
  );

  Deno.test(
    SUBTEST_NAME + ": wipeDocument",
    async () => {
      const share = "+gardening.abcde";
      const replica = makeReplica(share);

      const keypair1 = await Crypto.generateAuthorKeypair("aaaa");

      if (isErr(keypair1)) {
        assert(false, "error making keypair");
      }

      const bytes1 = new TextEncoder().encode("Hi!");

      await replica.set(keypair1, {
        text: "Hello",
        path: "/to_wipe.txt",
        blob: bytes1,
      });

      const wipeRes = await replica.wipeDocAtPath(keypair1, "/to_wipe.txt");

      assert(!isErr(wipeRes));

      const doc = await replica.getLatestDocAtPath("/to_wipe.txt");

      assert(doc);

      assertEquals(doc.text, "");

      const blob = await replica.getBlob(doc);

      assert(isErr(blob));

      await replica.close(true);
    },
  );

  if (
    scenario.subscenarios.docDriver.persistent &&
    scenario.subscenarios.attachmentDriver.persistent
  ) {
    Deno.test(
      {
        name: SUBTEST_NAME + ": pruning expired docs and attachments",
        fn: async (test) => {
          const share = "+gardening.abcde";
          const replica = makeReplica(share);

          const keypair1 = await Crypto.generateAuthorKeypair("aaaa");

          if (isErr(keypair1)) {
            assert(false, "error making keypair");
          }

          const now = microsecondNow();

          // Create an expired document
          await replica.set(keypair1, {
            text: "byeee",
            path: "/expire!",
            deleteAfter: now + 500,
          });

          // Create a doc with an attachment
          // Replace that doc with new attachment
          const bytes1 = new TextEncoder().encode("Hi!");
          const bytes2 = new TextEncoder().encode("Yo!");

          await replica.set(keypair1, {
            text: "A greeting",
            path: "/greeting.txt",
            blob: bytes1,
          });

          const blobDoc1 = await replica.getLatestDocAtPath("/greeting.txt");

          assert(blobDoc1);

          await replica.set(keypair1, {
            path: "/greeting.txt",
            blob: bytes2,
          });

          const blobDoc2 = await replica.getLatestDocAtPath("/greeting.txt");

          assert(blobDoc2);

          // close the replica,
          await replica.close(false);

          const replica2 = makeReplica(share);

          await test.step({
            name: "check expired doc is erased",
            fn: async () => {
              // start it again
              // check expired document is gone

              const expiredRes = await replica2.getLatestDocAtPath("/expire!");

              assertEquals(expiredRes, undefined);
            },
            sanitizeOps: false,
          });

          await test.step({
            name: "check attachments have been erased",
            fn: async () => {
              const attachment1Res = await replica2.getBlob(blobDoc1);

              assert(!isErr(attachment1Res));

              assertEquals(
                attachment1Res,
                undefined,
                "first attachment was erased",
              );

              const attachment2Res = await replica2.getBlob(blobDoc2);

              assert(!isErr(attachment2Res));

              assert(attachment2Res, "second attachment was kept");

              await streamToBytes(attachment2Res.stream);
            },
            sanitizeOps: false,
          });

          await replica2.close(true);
        },
      },
    );
  }

  //
}

for (const scenario of scenarios) {
  runRelpicaTests(scenario);
}
