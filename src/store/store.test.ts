import { CryptoES } from "../crypto/crypto_es.ts";
import { CryptoDriverWebExtractable } from "../crypto/drivers/webcrypto.ts";
import { Store } from "./store.ts";
import { meadowcap } from "../auth/auth.ts";
import { IdentityKeypair } from "../crypto/types.ts";
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.203.0/assert/mod.ts";
import { DocumentSetEvent } from "./events.ts";
import { Document } from "./types.ts";
import { isErr, notErr } from "../util/errors.ts";

const cryptoEs = new CryptoES(new CryptoDriverWebExtractable());
const addr = cryptoEs.generateCommunalNamespaceAddress("gardening");
const identity = await cryptoEs.generateIdentityKeypair(
  "suzy",
) as IdentityKeypair<Uint8Array>;

const capability = meadowcap.createCapCommunal({
  accessMode: "write",
  namespace: addr,
  user: identity.identityAddress,
});

const auth = {
  capability,
  secret: identity.privateKey,
};

function newStore() {
  return new Store(addr);
}

Deno.test("Store.set", async () => {
  const store = newStore();

  const result = await store.set({
    identity: identity.identityAddress,
    path: ["test"],
    payload: new TextEncoder().encode("Hello world"),
  }, auth);

  assert(result.kind === "success");
  assertEquals(result.document.identity, identity.identityAddress);
  assertEquals(result.document.path, ["test"]);
});

Deno.test("Store.set uses manual timestamp", async () => {
  const store = newStore();

  const result = await store.set({
    identity: identity.identityAddress,
    path: ["test"],
    payload: new TextEncoder().encode("Hello world"),
    timestamp: 1000n,
  }, auth);

  assert(result.kind === "success");
  assertEquals(result.document.timestamp, 1000n);
});

Deno.test("Store.set rejects invalid identity", async () => {
  const store = newStore();

  const result = await store.set({
    identity: "james",
    path: ["test"],
    payload: new TextEncoder().encode("Hello world"),
  }, auth);

  assert(result.kind === "failure");
});

Deno.test("Store.set rejects invalid path ", async () => {
  const store = newStore();

  const result = await store.set({
    identity: identity.identityAddress,
    path: ["bad/test"],
    payload: new TextEncoder().encode("Hello world"),
  }, auth);

  assert(result.kind === "failure");
});

Deno.test("Store.set permitPruning option", async () => {
  const store = newStore();

  await store.set({
    identity: identity.identityAddress,
    path: ["root", "nested"],
    payload: new TextEncoder().encode("Hello world"),
  }, auth);

  const result = await store.set({
    identity: identity.identityAddress,
    path: ["root"],
    payload: new TextEncoder().encode("Hello world"),
  }, auth);

  assertEquals(result.kind, "pruning_prevented");

  const result2 = await store.set(
    {
      identity: identity.identityAddress,
      path: ["root"],
      payload: new TextEncoder().encode("Hello world"),
    },
    auth,
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
    identity: identity.identityAddress,
    path: ["test"],
    payload: new TextEncoder().encode("Hello world"),
  }, auth);

  assert(gotEventDoc);
  assertEquals((gotEventDoc as Document).identity, identity.identityAddress);
  assertEquals((gotEventDoc as Document).path, ["test"]);
});

///

Deno.test("Store.clear", async () => {
  const store = newStore();

  await store.set({
    identity: identity.identityAddress,
    path: ["test"],
    payload: new TextEncoder().encode("Hello world"),
  }, auth);

  const result = await store.clear(identity.identityAddress, ["test"], auth);

  assert(notErr(result));

  const clearedDoc = await store.get(identity.identityAddress, ["test"]);

  assert(clearedDoc);
  assert(notErr(clearedDoc));
  assertEquals(clearedDoc.size, 0n);
});

Deno.test("Store.clear can't clear non-existent docs", async () => {
  const store = newStore();

  const result = await store.clear(identity.identityAddress, ["test"], auth);

  assert(isErr(result));
});

///

Deno.test("Store.get", async () => {
  const store = newStore();

  await store.set({
    identity: identity.identityAddress,
    path: ["test"],
    payload: new TextEncoder().encode("Hello world"),
  }, auth);

  const doc = await store.get(identity.identityAddress, ["test"]);

  assert(doc);
  assert(notErr(doc));
  assertEquals(doc.identity, identity.identityAddress);
  assertEquals(doc.path, ["test"]);
});

Deno.test("Store.get rejects invalid identity", async () => {
  const store = newStore();

  const result = await store.get("moriarty", ["test"]);

  assert(isErr(result));
});

Deno.test("Store.get rejects invalid path", async () => {
  const store = newStore();

  const result = await store.get(identity.identityAddress, ["👹"]);

  assert(isErr(result));
});

///

Deno.test("Store.documents", async () => {
  const store = newStore();

  await store.set({
    identity: identity.identityAddress,
    path: ["test"],
    payload: new TextEncoder().encode("Hello world"),
  }, auth);

  await store.set({
    identity: identity.identityAddress,
    path: ["test", "2"],
    payload: new TextEncoder().encode("Hello world"),
  }, auth);

  await store.set({
    identity: identity.identityAddress,
    path: ["also", "test"],
    payload: new TextEncoder().encode("Hello world"),
  }, auth);

  const docs = [];

  for await (const doc of store.documents()) {
    docs.push(doc);
  }

  assertEquals(docs.length, 3);
  assertEquals(docs.map((doc) => doc.path), [
    [
      "also",
      "test",
    ],
    ["test"],
    ["test", "2"],
  ]);
});

Deno.test("Store.documents respects ordering", async () => {
  const store = newStore();

  await store.set({
    identity: identity.identityAddress,
    path: ["test"],
    payload: new TextEncoder().encode("Hello world"),
  }, auth);

  await store.set({
    identity: identity.identityAddress,
    path: ["test", "2"],
    payload: new TextEncoder().encode("Hello world"),
  }, auth);

  await store.set({
    identity: identity.identityAddress,
    path: ["also", "test"],
    payload: new TextEncoder().encode("Hello world"),
  }, auth);

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
  assertEquals(docs.map((doc) => doc.path), [
    [
      "also",
      "test",
    ],
    ["test", "2"],
    ["test"],
  ]);
});

///

const identity2 = await cryptoEs.generateIdentityKeypair(
  "jose",
) as IdentityKeypair<Uint8Array>;

const capability2 = meadowcap.createCapCommunal({
  accessMode: "write",
  namespace: addr,
  user: identity2.identityAddress,
});

const auth2 = {
  capability: capability2,
  secret: identity2.privateKey,
};

Deno.test("Store.latestDocAtPath", async () => {
  const store = newStore();

  await store.set({
    identity: identity.identityAddress,
    path: ["test"],
    payload: new TextEncoder().encode("Hello world"),
  }, auth);

  await store.set({
    identity: identity2.identityAddress,
    path: ["test"],
    payload: new TextEncoder().encode("Yo!!!"),
  }, auth2);

  const latest = await store.latestDocAtPath(["test"]);

  assert(latest);
  assert(notErr(latest));
  assertEquals(latest.identity, identity2.identityAddress);
});

Deno.test("Store.latestDocAtPath rejects invalid path", async () => {
  const store = newStore();

  const latest = await store.latestDocAtPath(["yo/ho"]);

  assert(isErr(latest));
});

///

Deno.test("Store.documentsAtPath", async () => {
  const store = newStore();

  await store.set({
    identity: identity.identityAddress,
    path: ["test"],
    payload: new TextEncoder().encode("Hello world"),
  }, auth);

  await store.set({
    identity: identity2.identityAddress,
    path: ["test"],
    payload: new TextEncoder().encode("Yo!!!"),
  }, auth2);

  const docs = [];

  for await (const doc of store.documentsAtPath(["test"])) {
    docs.push(doc);
  }

  assertEquals(docs.length, 2);
  assertEquals(docs.map((doc) => doc.identity), [
    identity2.identityAddress,
    identity.identityAddress,
  ]);
});

Deno.test("Store.latestDocAtPath rejects invalid path", async () => {
  const store = newStore();

  await assertRejects(async () => {
    for await (const _doc of store.documentsAtPath(["bloo/blaa"])) {
      // This will throw.
    }
  });
});

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
    identity: identity.identityAddress,
    path: ["test1"],
    payload: new TextEncoder().encode("Hello world"),
    timestamp: 1000n,
  }, auth);

  await store.set({
    identity: identity2.identityAddress,
    path: ["test2"],
    payload: new TextEncoder().encode("Yo!!!"),
    timestamp: 2000n,
  }, auth2);

  const docsAll = await collect(store.queryDocs({}));
  assertEquals(docsAll.length, 2);

  const docsIdentity2 = await collect(store.queryDocs({
    identity: identity2.identityAddress,
  }));
  assertEquals(docsIdentity2.length, 1);
  assert(
    docsIdentity2.every((doc) => doc.identity === identity2.identityAddress),
  );

  const docsTest1 = await collect(store.queryDocs({
    pathPrefix: ["test1"],
  }));
  assertEquals(docsTest1.length, 1);
  assertEquals(
    docsTest1[0].path,
    ["test1"],
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
  assertEquals(docsOrderPath.map((doc) => doc.path), [["test1"], ["test2"]]);

  const docsDescending = await collect(store.queryDocs({
    descending: true,
  }));
  assertEquals(docsDescending.length, 2);
  assertEquals(docsDescending.map((doc) => doc.path), [["test2"], ["test1"]]);
});

Deno.test("Store.queryPaths", async () => {
  const store = newStore();

  await store.set({
    identity: identity.identityAddress,
    path: ["test1"],
    payload: new TextEncoder().encode("Hello world"),
    timestamp: 1000n,
  }, auth);

  await store.set({
    identity: identity2.identityAddress,
    path: ["test2"],
    payload: new TextEncoder().encode("Yo!!!"),
    timestamp: 2000n,
  }, auth2);

  const paths = await collect(store.queryPaths({
    identity: identity2.identityAddress,
  }));
  assertEquals(paths, [["test2"]]);
});

Deno.test("Store.queryIdentities", async () => {
  const store = newStore();

  await store.set({
    identity: identity.identityAddress,
    path: ["test1"],
    payload: new TextEncoder().encode("Hello world"),
    timestamp: 1000n,
  }, auth);

  await store.set({
    identity: identity2.identityAddress,
    path: ["test2"],
    payload: new TextEncoder().encode("Yo!!!"),
    timestamp: 2000n,
  }, auth2);

  const identities = await collect(store.queryIdentities({
    pathPrefix: ["test1"],
  }));
  assertEquals(identities, [identity.identityAddress]);
});
