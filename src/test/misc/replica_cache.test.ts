import {
  assert,
  assertEquals,
  assertExists,
  assertNotStrictEquals,
  assertStrictEquals,
  assertThrows,
} from "../asserts.ts";
import { Crypto } from "../../crypto/crypto.ts";
import { AuthorKeypair } from "../../util/doc-types.ts";
import { DocDriverMemory } from "../../replica/doc_drivers/memory.ts";
import { Replica } from "../../replica/replica.ts";
import { ReplicaCache } from "../../replica/replica_cache.ts";
import { isErr, ReplicaCacheIsClosedError } from "../../util/errors.ts";
import { throws } from "../test-utils.ts";
import { sleep } from "../../util/misc.ts";
import { FormatEs4 } from "../../formats/format_es4.ts";
import { AttachmentDriverMemory } from "../../replica/attachment_drivers/memory.ts";

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
      driver: {
        docDriver: new DocDriverMemory(SHARE_ADDR),
        attachmentDriver: new AttachmentDriverMemory(),
      },
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
  assertEquals(
    values.orangesDoc,
    undefined,
    "latestDocAtPath result is undefined",
  );

  await replica.set(keypair, {
    content: "Hello!",
    path: "/test/hello.txt",
  }, FormatEs4);

  await sleep(100);
  // Cache should have be updated five times
  // Once for allDocs
  // Once for latestDocs

  assertEquals(cache.version, 5, "Cache was updated five times");

  replica.set(keypair, {
    content: "Apples!",
    path: "/test/apples.txt",
  }, FormatEs4);

  await sleep(100);
  // Cache should have be updated seven times
  // Once for allDocs
  // Once for latestDocs
  assertEquals(cache.version, 7, "Cache was updated seven times");

  replica.set(keypair, {
    content: "Oranges!",
    path: "/test/oranges.txt",
  }, FormatEs4);

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

  replica.set(keypairB, {
    content: "Suzy's Oranges!",
    path: "/test/oranges.txt",
  }, FormatEs4);

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
    cache.set(keypair, {
      content: "na",
      path: "bloo",
    }, FormatEs4);
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

  // Attachments

  const attachmentsCache = new ReplicaCache(replica);

  const res = await replica.set(keypair, {
    text: "A test attachment",
    path: "/attachment.txt",
    attachment: new TextEncoder().encode("Hello"),
  });

  assert(res.kind === "success");

  const firstResult = attachmentsCache.getAttachment(res.doc);

  assertEquals(firstResult, undefined);

  await sleep(10);

  const secondResult = attachmentsCache.getAttachment(res.doc);

  assert(!isErr(secondResult));
  assert(secondResult);

  // Cache updates when doc is set again
  const res2 = await replica.set(keypair, {
    path: "/attachment.txt",
    attachment: new TextEncoder().encode("Greetings"),
  });

  assert(res2.kind === "success");

  await sleep(10);

  const thirdResult = attachmentsCache.getAttachment(res2.doc);

  assert(thirdResult);
  assert(!isErr(thirdResult));
  assertEquals(
    new TextDecoder().decode(await thirdResult.bytes()),
    "Greetings",
  );

  // Cache updates when doc is wiped
  await replica.wipeDocAtPath(keypair, "/attachment.txt");

  await sleep(10);

  const fourthResult = attachmentsCache.getAttachment(res2.doc);

  assert(isErr(fourthResult));

  // Attachment disappears when doc expires.

  const expiredRes = await replica.set(keypair, {
    path: "/!attachment.txt",
    text: "An ephemeral attachment",
    attachment: new TextEncoder().encode("See you soon!"),
    deleteAfter: (Date.now() + 100) * 1000,
  });

  assert(expiredRes.kind === "success");

  attachmentsCache.getAttachment(expiredRes.doc);

  await sleep(10);

  const expiredResFst = attachmentsCache.getAttachment(expiredRes.doc);

  assert(expiredResFst);

  await sleep(500);

  const expiredResSnd = attachmentsCache.getAttachment(expiredRes.doc);

  assert(isErr(expiredResSnd));

  const addAttachmentsFstRes = attachmentsCache.addAttachments([
    res.doc,
    expiredRes.doc,
  ]);

  assert(isErr(addAttachmentsFstRes[0].attachment));
  assert(isErr(addAttachmentsFstRes[1].attachment));

  const res3 = await replica.set(keypair, {
    path: "/attachment.txt",
    text: "A new greeting",
    attachment: new TextEncoder().encode("Yo!"),
  });

  const res4 = await replica.set(keypair, {
    path: "/attachment2.txt",
    text: "A new farewell",
    attachment: new TextEncoder().encode("Cya!"),
  });

  await sleep(10);

  assert(res3.kind === "success");
  assert(res4.kind === "success");

  const addAttachmentSndRes = attachmentsCache.addAttachments([
    res3.doc,
    res4.doc,
    expiredRes.doc,
  ]);

  assert(addAttachmentSndRes[0].attachment);
  assertEquals(addAttachmentSndRes[1].attachment, undefined);
  assert(!isErr(addAttachmentSndRes[0].attachment));

  await sleep(10);

  const addAttachmentThdRes = attachmentsCache.addAttachments([
    res3.doc,
    res4.doc,
    expiredRes.doc,
  ]);

  assert(addAttachmentThdRes[0].attachment);
  assert(addAttachmentThdRes[1].attachment);
  assert(!isErr(addAttachmentThdRes[0].attachment));
  assert(!isErr(addAttachmentThdRes[1].attachment));

  // Finish up

  await replica.close(true);
});
