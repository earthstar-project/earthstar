import { CryptoES } from "../../crypto/crypto_es.ts";
import { CryptoDriverWebExtractable } from "../../crypto/drivers/webcrypto.ts";
import { Store } from "./store.ts";
import { Store as BaseStore } from '../../store/store.ts';
import { meadowcap } from "../../auth/auth.ts";
import { IdentityKeypair } from "../../crypto/types.ts";
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.203.0/assert/mod.ts";

import { stringify } from "jsr:@std/yaml";
import { Document } from "../../store/types.ts";

const cryptoEs = new CryptoES(new CryptoDriverWebExtractable());
const addr = cryptoEs.generateCommunalNamespaceAddress("gardening");
const identity = await cryptoEs.generateIdentityKeypair(
  "suzy",
) as IdentityKeypair<Uint8Array>;
const janeIdentity = await cryptoEs.generateIdentityKeypair(
  "jane",
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
  return new Store(new BaseStore(addr), identity);
}

function newJaneStore() {
  return new Store(new BaseStore(addr), janeIdentity);
}

Deno.test("Store.getAllEncryptionSettings", async () => {
  const store = newStore();

  await store.set({
    identity: identity.identityAddress,
    path: ["encryption", "1.0", "payload.yaml"],
    payload: new TextEncoder().encode(stringify({
      rules: [{
        algorithm: "none",
        kdf: "static",
        keyName: "",
        pathPattern: ["**"],
        type: "payload",
      }],
    })),
  }, auth);

  await store.set({
    identity: identity.identityAddress,
    path: ["encryption", "1.0", "invalid", "payload.yaml"],
    payload: new TextEncoder().encode("Hello world"),
  }, auth);

  await store.set({
    identity: identity.identityAddress,
    path: ["encryption", "1.0", "foo", "bar", "payload.yaml"],
    payload: new TextEncoder().encode(stringify({
      rules: [{
        algorithm: "none",
        kdf: "static",
        keyName: "",
        pathPattern: ["foo", "bar", "**"],
        type: "payload",
      }],
    })),
  }, auth);

  await store.set({
    identity: identity.identityAddress,
    path: ["other", "encryption", "1.0", "foo", "bar", "payload.yaml"],
    payload: new TextEncoder().encode(stringify({
      rules: [{
        algorithm: "none",
        kdf: "static",
        keyName: "",
        pathPattern: ["foo", "bar", "**"],
        type: "payload",
      }],
    })),
  }, auth);

  const result = await store.getAllEncryptionSettings(
    identity.identityAddress,
  )

  assertEquals(result.length, 2);
});

Deno.test("Store.getEncryptionSettingsForPath", async () => {
  const store = newStore();

  await store.set({
    identity: identity.identityAddress,
    path: ["encryption", "1.0", "payload.yaml"],
    payload: new TextEncoder().encode(stringify({
      rules: [{
        algorithm: "base32",
        kdf: "static",
        keyName: "",
        pathPattern: ["**"],
        type: "payload",
      }],
    })),
  }, auth);

  await store.set({
    identity: identity.identityAddress,
    path: ["encryption", "1.0", "foo", "bar", "payload.yaml"],
    payload: new TextEncoder().encode(stringify({
      rules: [{
        algorithm: "none",
        kdf: "static",
        keyName: "",
        pathPattern: ["foo", "bar", "**"],
        type: "payload",
      }],
    })),
  }, auth);

  let result = await store.getEncryptionSettingsForPath(
    identity.identityAddress,
    [],
    "payload",
  )

  assertEquals(result.keyName, '');
  assertEquals(result.algorithm, 'base32');

  result = await store.getEncryptionSettingsForPath(
    identity.identityAddress,
    ["foo", "bar"],
    "payload",
  )

  assertEquals(result.keyName, '');
  assertEquals(result.algorithm, 'base32');

  result = await store.getEncryptionSettingsForPath(
    identity.identityAddress,
    ["foo", "bar", "baz"],
    "payload",
  )

  assertEquals(result.keyName, '');
  assertEquals(result.algorithm, 'none');
});

Deno.test("Store.encryptPath / base32", async () => {
  const store = newStore();

  await store.set({
    identity: identity.identityAddress,
    path: ["encryption", "1.0", "path.yaml"],
    payload: new TextEncoder().encode(stringify({
      rules: [{
        algorithm: "base32",
        kdf: "static",
        pathPattern: ["**"],
        type: "path",
      }],
    })),
  }, auth);

  const result = await store.encryptPath(
    identity.identityAddress,
    ["foo", "bar"],
  )

  assertEquals(result.length, 2);
  assertEquals(result, ["bmzxw6", "bmjqxe"]);
});

Deno.test("Store.decryptPath / base32", async () => {
  const store = newStore();

  await store.set({
    identity: identity.identityAddress,
    path: ["encryption", "1.0", "path.yaml"],
    payload: new TextEncoder().encode(stringify({
      rules: [{
        algorithm: "base32",
        kdf: "static",
        pathPattern: ["**"],
        type: "path",
      }],
    })),
  }, auth);

  const result = await store.decryptPath(
    identity.identityAddress,
    ["bmzxw6", "bmjqxe"],
  )

  assertEquals(result.length, 2);
  assertEquals(result, ["foo", "bar"]);
});

Deno.test("Store.roundtrip / base32", async () => {
  const store = newStore();

  await store.set({
    identity: identity.identityAddress,
    path: ["encryption", "1.0", "path.yaml"],
    payload: new TextEncoder().encode(stringify({
      rules: [{
        algorithm: "base32",
        kdf: "static",
        pathPattern: ["**"],
        type: "path",
      }],
    })),
  }, auth);

  await store.set({
    identity: identity.identityAddress,
    path: ["encryption", "1.0", "payload.yaml"],
    payload: new TextEncoder().encode(stringify({
      rules: [{
        algorithm: "base32",
        kdf: "static",
        pathPattern: ["**"],
        type: "payload",
      }],
    })),
  }, auth);

  await store.set({
    identity: identity.identityAddress,
    path: ["foo"],
    payload: new TextEncoder().encode("bar"),
  }, auth);

  const result = await store.get(
    identity.identityAddress,
    ["foo"],
  ) as Document

  assert(result.payload)
  assertEquals(new TextDecoder().decode(await result.payload.bytes()), "bar");

  const encryptedResult = await store.baseStore.get(
    identity.identityAddress,
    ["bmzxw6"],
  ) as Document

  assert(encryptedResult.payload)
  assertEquals(new TextDecoder().decode(await encryptedResult.payload.bytes()), "bmjqxe");
});

// Deno.test("Store.roundtrip / aws-gcm-siv", async () => {
//   const store = newStore();

//   // AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=

//   await store.set({
//     identity: identity.identityAddress,
//     path: ["encryption", "1.0", "path.yaml"],
//     payload: new TextEncoder().encode(stringify({
//       rules: [{
//         algorithm: "aws-gcm-siv",
//         recursive: true,
//         kdf: "static",
//       }],
//     })),
//   }, auth);

//   await store.set({
//     identity: identity.identityAddress,
//     path: ["foo"],
//     payload: new TextEncoder().encode("bar"),
//   }, auth);

//   const result = await store.get(
//     identity.identityAddress,
//     ["foo"],
//   ) as Document

//   assert(result.payload)
//   assertEquals(new TextDecoder().decode(await result.payload.bytes()), "bar");

//   const encryptedResult = await store.baseStore.get(
//     identity.identityAddress,
//     ["bmzxw6"],
//   ) as Document

//   assert(encryptedResult.payload)
//   assertEquals(new TextDecoder().decode(await encryptedResult.payload.bytes()), "bmjqxe");
// });

Deno.test("Store.encryptPath / scalarmult-hkdf / scalarmult-hkdf", async () => {
  const suzyStore = newStore();
  const janeStore = newJaneStore();

  for (const store of [suzyStore, janeStore]) {
    // Insert the same setup document into both stores, under Suzy's identity
    await store.set({
      identity: identity.identityAddress,
      path: ["encryption", "1.0", "scalarmult", "path.yaml"],
      payload: new TextEncoder().encode(stringify({
        rules: [
          {
            algorithm: "scalarmult-hkdf",
            kdf: "scalarmult-hkdf",
            pathPattern: ["scalarmult", "*"],
            type: "path",
          },
          {
            algorithm: "aes-gcm-siv",
            kdf: "from-parent",
            pathPattern: ["scalarmult", "*", "**"],
            type: "path",
          }
        ],
      })),
    }, auth);
  }

  const suzyResult = await suzyStore.encryptPath(
    identity.identityAddress,
    ["scalarmult", janeIdentity.identityAddress],
  )

  const janeResult = await janeStore.encryptPath(
    identity.identityAddress,
    ["scalarmult", janeIdentity.identityAddress],
  )

  assertEquals(suzyResult, janeResult);

  const decryptResult = await janeStore.decryptPath(
    identity.identityAddress,
    suzyResult,
  )

  assertEquals(decryptResult, ["scalarmult", janeIdentity.identityAddress]);

  const subPathResult = await suzyStore.encryptPath(
    identity.identityAddress,
    ["scalarmult", janeIdentity.identityAddress, "test"],
  )

  const decryptSubPathResult = await janeStore.decryptPath(
    identity.identityAddress,
    subPathResult,
  )

  assertEquals(decryptSubPathResult, ["scalarmult", janeIdentity.identityAddress, "test"]);
});
