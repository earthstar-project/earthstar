import { meadowcap } from "../src/auth/auth.ts";
import { CryptoES } from "../src/crypto/crypto_es.ts";
import { CryptoDriverWebExtractable } from "../src/crypto/drivers/webcrypto.ts";
import { Store } from "../src/store/store.ts";
import { isErr } from "../src/util/errors.ts";
const cryptoEs = new CryptoES(new CryptoDriverWebExtractable());
const addr = cryptoEs.generateCommunalNamespaceAddress("earthstar");

const identity = await cryptoEs.generateIdentityKeypair("gwil");
const identity2 = await cryptoEs.generateIdentityKeypair("suzy");

if (isErr(identity)) {
  Deno.exit(1);
}

if (isErr(identity2)) {
  Deno.exit(1);
}

const capability = meadowcap.createCapCommunal({
  accessMode: "write",
  namespace: addr,
  user: identity.identityAddress,
});

const capability2 = meadowcap.createCapCommunal({
  accessMode: "write",
  namespace: addr,
  user: identity2.identityAddress,
});

const store = new Store(addr);

store.addEventListener("documentset", (event) => {
  console.log(event);
});

const result = await store.set(
  {
    path: ["greetings", "initial"],
    identity: identity.identityAddress,
    payload: new TextEncoder().encode("Hello world!"),
  },
  {
    capability,
    secret: identity.privateKey,
  },
);

if (result.kind !== "success") {
  console.log(result);
  Deno.exit(1);
}

console.log(result);

if (result.document.payload) {
  const bytes = await result.document.payload.bytes();

  console.log(new TextDecoder().decode(bytes));
}

const getRes = await store.get(
  identity.identityAddress,
  ["greetings", "initial"],
);

console.log({ getRes });

await store.set(
  {
    path: ["greetings", "initial"],
    identity: identity2.identityAddress,
    payload: new TextEncoder().encode("Hi planet!"),
  },
  {
    capability: capability2,
    secret: identity2.privateKey,
  },
);

for await (const doc of store.documents()) {
  console.log(doc);
}

const latestRes = await store.latestDocAtPath(["greetings", "initial"]);

console.log({ latestRes });

const getRes2 = await store.get(identity2.identityAddress, [
  "greetings",
  "initial",
]);

console.log({ getRes2 });

const clearRes = await store.clear(identity2.identityAddress, [
  "greetings",
  "initial",
], {
  capability: capability2,
  secret: identity2.privateKey,
});

console.log({ clearRes });

for await (const doc of store.documentsAtPath(["greetings", "initial"])) {
  console.log(doc);
}

for await (const path of store.queryPaths({})) {
  console.log(path);
}

for await (const identity of store.queryIdentities({})) {
  console.log(identity);
}
