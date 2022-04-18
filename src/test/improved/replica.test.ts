import { assert, assertEquals, assertThrows } from "../asserts.ts";
import { doesNotThrow, throws } from "../test-utils.ts";
import { ShareAddress } from "../../util/doc-types.ts";
import { IReplica } from "../../replica/replica-types.ts";
import { isErr } from "../../util/errors.ts";
import { microsecondNow, sleep } from "../../util/misc.ts";
import { Crypto } from "../../crypto/crypto.ts";
import { GlobalCryptoDriver } from "../../crypto/global-crypto-driver.ts";
import { FormatValidatorEs4 } from "../../format-validators/format-validator-es4.ts";
import { Replica } from "../../replica/replica.ts";

import { TestScenario } from "../test-scenario-types.ts";
import { testScenarios } from "../test-scenarios.ts";

//================================================================================

import { Logger } from "../../util/log.ts";
const loggerTest = new Logger("test", "whiteBright");
const loggerTestCb = new Logger("test cb", "white");
//setLogLevel('test', LogLevel.Debug);

//================================================================================

export function runRelpicaTests(scenario: TestScenario) {
  const SUBTEST_NAME = scenario.name;

  function makeReplica(ws: ShareAddress): IReplica {
    const driver = scenario.makeDriver(ws);
    return new Replica(ws, FormatValidatorEs4, driver);
  }

  Deno.test(
    SUBTEST_NAME + ": replica close() and throwing when closed",
    async () => {
      const initialCryptoDriver = GlobalCryptoDriver;

      const share = "+gardening.abcde";
      const storage = makeReplica(share);
      const events: string[] = [];

      assertEquals(
        typeof storage.replicaId,
        "string",
        "storage has a storageId",
      );

      // subscribe in a different order than they will normally happen,
      // to make sure they really happen in the right order when they happen for real
      storage.bus.on("didClose", (channel) => {
        loggerTestCb.debug(">> didClose event handler");
        events.push(channel);
      });
      storage.bus.on("willClose", (channel) => {
        loggerTestCb.debug(">> willClose event handler");
        events.push(channel);
      });

      assertEquals(storage.isClosed(), false, "is not initially closed");
      await doesNotThrow(
        async () => storage.isClosed(),
        "isClosed does not throw",
      );
      await doesNotThrow(
        async () => await storage.getDocsAfterLocalIndex("all", 0, 1),
        "does not throw because not closed",
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

      assertEquals(storage.isClosed(), true, "is closed after close()");

      await doesNotThrow(
        async () => storage.isClosed(),
        "isClosed does not throw",
      );
      throws(
        async () => await storage.getDocsAfterLocalIndex("all", 0, 1),
        "throws after closed",
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
        async () => await storage.set({} as any, {} as any),
        "throws after closed",
      );
      await throws(
        async () => await storage.ingest({} as any),
        "throws after closed",
      );
      await throws(
        async () => await storage.overwriteAllDocsByAuthor({} as any),
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
        format: "es.4",
      });

      await replica.set(keypair2, {
        path: "/doc2.txt",
        content: "content2",
        format: "es.4",
      });

      await replica.set(keypair1, {
        path: "/doc3.txt",
        content: "content3",
        format: "es.4",
      });

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
        format: "es.4",
        path: "/pathA",
        content: "content1",
        timestamp: now,
      });
      await storage.set(keypair2, {
        format: "es.4",
        path: "/pathA",
        content: "content2",
        timestamp: now + 3, // latest
      });

      await storage.set(keypair2, {
        format: "es.4",
        path: "/pathB",
        content: "content2",
        timestamp: now,
      });
      await storage.set(keypair1, {
        format: "es.4",
        path: "/pathB",
        content: "content1",
        timestamp: now + 3, // latest
      });

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

      let docsA = await storage.getAllDocsAtPath("/pathA"); // latest first
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

      let docsB = await storage.getAllDocsAtPath("/pathB"); // latest first
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
      const result = await storage.overwriteAllDocsByAuthor(keypair1);
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

      docsA = await storage.getAllDocsAtPath("/pathA"); // latest first
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

      docsB = await storage.getAllDocsAtPath("/pathB"); // latest first
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
}

for (const scenario of testScenarios) {
  runRelpicaTests(scenario);
}
