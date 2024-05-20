import { assert, assertEquals } from "@std/assert";
import { Store } from "./store.ts";
import { Auth } from "../auth/auth.ts";
import { DocumentSetEvent } from "./events.ts";
import { Document } from "./types.ts";
import { isErr, notErr } from "../util/errors.ts";
import { encodeShareTag, ShareKeypairRaw } from "../identifiers/share.ts";
import {
  encodeIdentityTag,
  IdentityKeypairRaw,
} from "../identifiers/identity.ts";
import {
  EntryDriverKvStore,
  KvDriverInMemory,
  PayloadDriverMemory,
} from "jsr:@earthstar/willow";
import { Path } from "../path/path.ts";
import { blake3std } from "../blake3/blake3.std.ts";
import { RuntimeDriverDeno } from "../runtime/driver_deno.ts";
import {
  fingerprintScheme,
  makePayloadScheme,
  namespaceScheme,
  pathScheme,
  subspaceScheme,
} from "../schemes/schemes.ts";

const auth = new Auth({
  password: "password1234",
  kvDriver: new KvDriverInMemory(),
  runtimeDriver: new RuntimeDriverDeno(),
});

const share = await auth.createShareKeypair(
  "gardening",
  false,
) as ShareKeypairRaw;
const shareDisplay = encodeShareTag(share.publicKey);
const identity = await auth.createIdentityKeypair(
  "suzy",
) as IdentityKeypairRaw;
const identityDisplay = encodeIdentityTag(identity.publicKey);

await auth.createFullCapPack(share.publicKey, identity.publicKey, "write");

function newStore() {
  const payload = new PayloadDriverMemory(makePayloadScheme(blake3std));

  const entry = new EntryDriverKvStore({
    namespaceScheme,
    subspaceScheme,
    pathScheme,
    payloadScheme: makePayloadScheme(blake3std),
    getPayloadLength: (digest) => payload.length(digest),
    fingerprintScheme: fingerprintScheme,
    kvDriver: new KvDriverInMemory(),
  });

  return new Store(shareDisplay, auth, {
    runtimeDriver: new RuntimeDriverDeno(),
    entryDriver: entry,
    payloadDriver: payload,
  });
}

Deno.test("Store.set", async () => {
  const store = newStore();

  const path = Path.fromStrings("test");

  const result = await store.set({
    identity: identityDisplay,
    path: path,
    payload: new TextEncoder().encode("Hello world"),
  });

  assert(result.kind === "success");
  assertEquals(result.document.identity, identityDisplay);
  assertEquals(result.document.path.underlying, path.underlying);
});

Deno.test("Store.set uses manual timestamp", async () => {
  const store = newStore();

  const result = await store.set({
    identity: identityDisplay,
    path: Path.fromStrings("test"),
    payload: new TextEncoder().encode("Hello world"),
    timestamp: 1000n,
  });

  assert(result.kind === "success");
  assertEquals(result.document.timestamp, 1000n);
});

Deno.test("Store.set rejects invalid identity", async () => {
  const store = newStore();

  const result = await store.set({
    identity: "james",
    path: Path.fromStrings("test"),
    payload: new TextEncoder().encode("Hello world"),
  });

  assert(result.kind === "failure");
});

/*
Deno.test("Store.set rejects invalid path ", async () => {
  const store = newStore();

  const result = await store.set({
    identity: identityDisplay,
    path: ["bad/test"],
    payload: new TextEncoder().encode("Hello world"),
  });

  assert(result.kind === "failure");
});
*/

Deno.test("Store.set permitPruning option", async () => {
  const store = newStore();

  await store.set({
    identity: identityDisplay,
    path: Path.fromStrings("root", "nested"),
    payload: new TextEncoder().encode("Hello world"),
  });

  const result = await store.set({
    identity: identityDisplay,
    path: Path.fromStrings("root"),
    payload: new TextEncoder().encode("Hello world"),
  });

  assertEquals(result.kind, "pruning_prevented");

  const result2 = await store.set(
    {
      identity: identityDisplay,
      path: Path.fromStrings("root"),
      payload: new TextEncoder().encode("Hello world"),
    },
    true,
  );

  assertEquals(result2.kind, "success");
});

Deno.test("Store.set emits event", async () => {
  const store = newStore();

  let gotEventDoc: Document | undefined = undefined;

  store.addEventListener("documentset", (event) => {
    const { detail: { document } } = event as DocumentSetEvent;

    gotEventDoc = document;
  });

  await store.set({
    identity: identityDisplay,
    path: Path.fromStrings("test"),
    payload: new TextEncoder().encode("Hello world"),
  });

  assert(gotEventDoc);
  assertEquals((gotEventDoc as Document).identity, identityDisplay);
  assertEquals(
    (gotEventDoc as Document).path.underlying,
    (Path.fromStrings("test")).underlying,
  );
});

///

Deno.test("Store.clear", async () => {
  const store = newStore();

  await store.set({
    identity: identityDisplay,
    path: Path.fromStrings("test"),
    payload: new TextEncoder().encode("Hello world"),
  });

  const result = await store.clear(
    identityDisplay,
    Path.fromStrings("test"),
  );

  assert(notErr(result));

  const clearedDoc = await store.get(
    identityDisplay,
    Path.fromStrings("test"),
  );

  assert(clearedDoc);
  assert(notErr(clearedDoc));
  assertEquals(clearedDoc.size, 0n);
});

Deno.test("Store.clear can't clear non-existent docs", async () => {
  const store = newStore();

  const result = await store.clear(
    identityDisplay,
    Path.fromStrings("test"),
  );

  assert(isErr(result));
});

///

Deno.test("Store.get", async () => {
  const store = newStore();

  await store.set({
    identity: identityDisplay,
    path: Path.fromStrings("test"),
    payload: new TextEncoder().encode("Hello world"),
  });

  const doc = await store.get(identityDisplay, Path.fromStrings("test"));

  assert(doc);
  assert(notErr(doc));
  assertEquals(doc.identity, identityDisplay);
  assertEquals(doc.path, Path.fromStrings("test"));
});

Deno.test("Store.get rejects invalid identity", async () => {
  const store = newStore();

  const result = await store.get("moriarty", Path.fromStrings("test"));

  assert(isErr(result));
});

/*
Deno.test("Store.get rejects invalid path", async () => {
  const store = newStore();

  const result = await store.get(identityDisplay, ["👹"]);

  assert(isErr(result));
});
*/

///

Deno.test("Store.documents", async () => {
  const store = newStore();

  await store.set({
    identity: identityDisplay,
    path: Path.fromStrings("test"),
    payload: new TextEncoder().encode("Hello world"),
  });

  await store.set({
    identity: identityDisplay,
    path: Path.fromStrings("test", "2"),
    payload: new TextEncoder().encode("Hello world"),
  });

  await store.set({
    identity: identityDisplay,
    path: Path.fromStrings("also", "test"),
    payload: new TextEncoder().encode("Hello world"),
  });

  const docs = [];

  for await (const doc of store.documents()) {
    docs.push(doc);
  }

  assertEquals(docs.length, 3);
  assertEquals(docs.map((doc) => doc.path.underlying), [
    Path.fromStrings(
      "also",
      "test",
    ).underlying,
    Path.fromStrings("test").underlying,
    Path.fromStrings("test", "2").underlying,
  ]);
});

Deno.test("Store.documents respects ordering", async () => {
  const store = newStore();

  await store.set({
    identity: identityDisplay,
    path: Path.fromStrings("test"),
    payload: new TextEncoder().encode("Hello world"),
  });

  await store.set({
    identity: identityDisplay,
    path: Path.fromStrings("test", "2"),
    payload: new TextEncoder().encode("Hello world"),
  });

  await store.set({
    identity: identityDisplay,
    path: Path.fromStrings("also", "test"),
    payload: new TextEncoder().encode("Hello world"),
  });

  const docs = [];

  for await (
    const doc of store.documents({
      order: "timestamp",
      descending: true,
    })
  ) {
    docs.push(doc);
  }

  assertEquals(docs.length, 3);
  assertEquals(docs.map((doc) => doc.path.underlying), [
    Path.fromStrings(
      "also",
      "test",
    ).underlying,
    Path.fromStrings("test", "2").underlying,
    Path.fromStrings("test").underlying,
  ]);
});

///

const identity2 = await auth.createIdentityKeypair(
  "yarp",
) as IdentityKeypairRaw;
const identity2Display = encodeIdentityTag(identity2.publicKey);

await auth.createFullCapPack(share.publicKey, identity2.publicKey, "write");

Deno.test("Store.latestDocAtPath", async () => {
  const store = newStore();

  await store.set({
    identity: identityDisplay,
    path: Path.fromStrings("test"),
    payload: new TextEncoder().encode("Hello world"),
  });

  await store.set({
    identity: identity2Display,
    path: Path.fromStrings("test"),
    payload: new TextEncoder().encode("Yo!!!"),
  });

  const latest = await store.latestDocAtPath(Path.fromStrings("test"));

  assert(latest);
  assert(notErr(latest));
  assertEquals(latest.identity, identity2Display);
});

/*
Deno.test("Store.latestDocAtPath rejects invalid path", async () => {
  const store = newStore();

  const latest = await store.latestDocAtPath(["yo/ho"]);

  assert(isErr(latest));
});
*/

///

Deno.test("Store.documentsAtPath", async () => {
  const store = newStore();

  await store.set({
    identity: identityDisplay,
    path: Path.fromStrings("test"),
    payload: new TextEncoder().encode("Hello world"),
  });

  await store.set({
    identity: identity2Display,
    path: Path.fromStrings("test"),
    payload: new TextEncoder().encode("Yo!!!"),
  });

  const docs = [];

  for await (const doc of store.documentsAtPath(Path.fromStrings("test"))) {
    docs.push(doc);
  }

  assertEquals(docs.length, 2);
  assertEquals(docs.map((doc) => doc.identity), [
    identity2Display,
    identityDisplay,
  ]);
});

/*
Deno.test("Store.latestDocAtPath rejects invalid path", async () => {
  const store = newStore();

  await assertRejects(async () => {
    for await (const _doc of store.documentsAtPath(["bloo/blaa"])) {
      // This will throw.
    }
  });
});
*/

async function collect<Value>(iter: AsyncIterable<Value>): Promise<Value[]> {
  const items = [];

  for await (const item of iter) {
    items.push(item);
  }

  return items;
}

Deno.test("Store.queryDocs", async () => {
  const store = newStore();

  await store.set({
    identity: identityDisplay,
    path: Path.fromStrings("test1"),
    payload: new TextEncoder().encode("Hello world"),
    timestamp: 1000n,
  });

  await store.set({
    identity: identity2Display,
    path: Path.fromStrings("test2"),
    payload: new TextEncoder().encode("Yo!!!"),
    timestamp: 2000n,
  });

  const docsAll = await collect(store.queryDocs({}));
  assertEquals(docsAll.length, 2);

  const docsIdentity2 = await collect(store.queryDocs({
    identity: identity2Display,
  }));
  assertEquals(docsIdentity2.length, 1);
  assert(
    docsIdentity2.every((doc) => doc.identity === identity2Display),
  );

  const docsTest1 = await collect(store.queryDocs({
    pathPrefix: Path.fromStrings("test1"),
  }));
  assertEquals(docsTest1.length, 1);
  assertEquals(
    docsTest1[0].path.underlying,
    Path.fromStrings("test1").underlying,
  );

  const docsTimestampGte = await collect(store.queryDocs({
    timestampGte: 1500n,
  }));
  assertEquals(docsTimestampGte.length, 1);
  assertEquals(
    docsTimestampGte[0].timestamp,
    2000n,
  );

  const docsTimestampLt = await collect(store.queryDocs({
    timestampLt: 1500n,
  }));
  assertEquals(docsTimestampLt.length, 1);
  assertEquals(
    docsTimestampLt[0].timestamp,
    1000n,
  );

  const docsLimit = await collect(store.queryDocs({
    limit: 1,
  }));
  assertEquals(docsLimit.length, 1);

  const docsMaxSize = await collect(store.queryDocs({
    maxSize: 12n,
  }));
  assertEquals(docsMaxSize.length, 1);

  const docsOrderPath = await collect(store.queryDocs({
    order: "path",
  }));
  assertEquals(docsOrderPath.length, 2);
  assertEquals(docsOrderPath.map((doc) => doc.path.underlying), [
    Path.fromStrings("test1").underlying,
    Path.fromStrings("test2").underlying,
  ]);

  const docsDescending = await collect(store.queryDocs({
    descending: true,
  }));
  assertEquals(docsDescending.length, 2);
  assertEquals(docsDescending.map((doc) => doc.path.underlying), [
    Path.fromStrings("test2").underlying,
    Path.fromStrings("test1").underlying,
  ]);
});

Deno.test("Store.queryPaths", async () => {
  const store = newStore();

  await store.set({
    identity: identityDisplay,
    path: Path.fromStrings("test1"),
    payload: new TextEncoder().encode("Hello world"),
    timestamp: 1000n,
  });

  await store.set({
    identity: identity2Display,
    path: Path.fromStrings("test2"),
    payload: new TextEncoder().encode("Yo!!!"),
    timestamp: 2000n,
  });

  const paths = await collect(store.queryPaths({
    identity: identity2Display,
  }));
  assertEquals(paths.map((path) => path.underlying), [
    Path.fromStrings("test2").underlying,
  ]);
});

Deno.test("Store.queryIdentities", async () => {
  const store = newStore();

  await store.set({
    identity: identityDisplay,
    path: Path.fromStrings("test1"),
    payload: new TextEncoder().encode("Hello world"),
    timestamp: 1000n,
  });

  await store.set({
    identity: identity2Display,
    path: Path.fromStrings("test2"),
    payload: new TextEncoder().encode("Yo!!!"),
    timestamp: 2000n,
  });

  const identities = await collect(store.queryIdentities({
    pathPrefix: Path.fromStrings("test1"),
  }));
  assertEquals(identities, [identityDisplay]);
});
