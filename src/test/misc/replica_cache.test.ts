import {
  assert,
  assertEquals,
  assertStrictEquals,
  assertThrows,
} from "../asserts.ts";
import { Crypto } from "../../crypto/crypto.ts";
import { AuthorKeypair } from "../../util/doc-types.ts";
import { DocDriverMemory } from "../../replica/doc_drivers/memory.ts";
import { Replica } from "../../replica/replica.ts";
import { ReplicaCache } from "../../replica/replica-cache.ts";
import { ReplicaCacheIsClosedError } from "../../util/errors.ts";
import { throws } from "../test-utils.ts";
import { sleep } from "../../util/misc.ts";
import { LogLevel, setLogLevel } from "../../util/log.ts";
import { FormatEs4 } from "../../formats/format_es4.ts";

//setLogLevel("replica-cache", LogLevel.Debug);

//================================================================================

const SHARE_ADDR = "+test.a123";

Deno.test("ReplicaCache", async () => {
  const keypair = await Crypto.generateAuthorKeypair("test") as AuthorKeypair;
  const keypairB = await Crypto.generateAuthorKeypair(
    "suzy",
  ) as AuthorKeypair;

  const replica = new Replica(
    {
      driver: { docDriver: new DocDriverMemory(SHARE_ADDR), blobDriver: null },
    },
  );

  const cache = new ReplicaCache(replica);

  assertEquals(cache.version, 0, "Cache version is 0");

  const values = {
    allDocs: cache.getAllDocs(),
    latestDocs: cache.getLatestDocs(),
    orangesDoc: cache.getLatestDocAtPath("/test/oranges.txt"),
  };

  cache.onCacheUpdated(() => {
    values.allDocs = cache.getAllDocs();
    values.latestDocs = cache.getLatestDocs();
    values.orangesDoc = cache.getLatestDocAtPath("/test/oranges.txt");
  });

  await sleep(100);
  // Cache should have be updated three times
  // Once for allDocs
  // Once for latestDocs
  // And once for oranges docs
  assertEquals(cache.version, 3, "Cache was updated three times");

  assertEquals(values.allDocs, [], "Cache for allDocs is empty");
  assertEquals(values.latestDocs, [], "Cache for latestDocs is empty");
  assertStrictEquals(
    values.orangesDoc,
    undefined,
    "latestDocAtPath result is undefined",
  );

  await cache._replica.set(keypair, FormatEs4, {
    content: "Hello!",
    path: "/test/hello.txt",
  });

  await sleep(100);
  // Cache should have be updated five times
  // Once for allDocs
  // Once for latestDocs

  assertEquals(cache.version, 5, "Cache was updated five times");

  cache._replica.set(keypair, FormatEs4, {
    content: "Apples!",
    path: "/test/apples.txt",
  });

  await sleep(100);
  // Cache should have be updated seven times
  // Once for allDocs
  // Once for latestDocs
  assertEquals(cache.version, 7, "Cache was updated seven times");

  cache._replica.set(keypair, FormatEs4, {
    content: "Oranges!",
    path: "/test/oranges.txt",
  });

  await sleep(100);
  // Cache should have be updated 10 times
  // Once for allDocs
  // Once for latestDocs
  // Once for orangesDoc
  assertEquals(cache.version, 10, "Cache was updated 10 times");

  assertStrictEquals(values.allDocs.length, 3);
  assertStrictEquals(values.latestDocs.length, 3);
  assertStrictEquals(values.orangesDoc?.path, "/test/oranges.txt");
  assertStrictEquals(values.orangesDoc?.author, keypair.address);

  cache._replica.set(keypairB, FormatEs4, {
    content: "Suzy's Oranges!",
    path: "/test/oranges.txt",
  });

  await sleep(100);
  // Cache should have be updated 13 times
  // Once for allDocs
  // Once for latestDocs
  // Once for orangesDoc
  assertEquals(cache.version, 13, "Cache was updated thirteen times");

  assertStrictEquals(values.allDocs.length, 4);
  assertStrictEquals(values.latestDocs.length, 3);
  assertStrictEquals(values.orangesDoc?.path, "/test/oranges.txt");
  assertStrictEquals(values.orangesDoc?.author, keypairB.address);

  // Test that

  await cache.close();

  assert(cache.isClosed(), "Cache is closed");

  throws(async () => {
    await cache.close();
  }, "Throws if you try to close twice.");

  assertThrows(() => {
    cache.getAllDocs();
  }, ReplicaCacheIsClosedError);

  assertThrows(() => {
    cache.getAllDocsAtPath("nya");
  }, ReplicaCacheIsClosedError);

  assertThrows(() => {
    cache.getLatestDocAtPath("nya");
  }, ReplicaCacheIsClosedError);

  assertThrows(() => {
    cache.getLatestDocs();
  }, ReplicaCacheIsClosedError);

  assertThrows(() => {
    cache.onCacheUpdated(() => {});
  }, ReplicaCacheIsClosedError);

  assertThrows(() => {
    cache.overwriteAllDocsByAuthor(keypair);
  }, ReplicaCacheIsClosedError);

  assertThrows(() => {
    cache.queryDocs({});
  }, ReplicaCacheIsClosedError);

  assertThrows(() => {
    cache.set(keypair, FormatEs4, {
      content: "na",
      path: "bloo",
    });
  }, ReplicaCacheIsClosedError);

  // Test cache expiry with a quickly expiring cache
  const expiringCache = new ReplicaCache(replica, 10);

  // Heat the cache by getting something.
  expiringCache.getAllDocs();
  await sleep(50);

  assertEquals(
    expiringCache.version,
    1,
    "Quickly expiring cache was updated once",
  );
  // Hit the cache again.
  expiringCache.getAllDocs();
  await sleep(50);
  // Cache version should be the same.
  assertEquals(
    expiringCache.version,
    1,
    "Quickly expiring cache was updated once, even after second request",
  );

  await replica.close(true);
});
