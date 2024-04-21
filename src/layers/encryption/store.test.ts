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
  return new Store(new BaseStore(addr));
}

Deno.test("Store.getAllEncryptionSettings", async () => {
  const store = newStore();

  await store.set({
    identity: identity.identityAddress,
    path: ["encryption", "1.0", "payload.yaml"],
    payload: new TextEncoder().encode("Hello world"),
  }, auth);

  await store.set({
    identity: identity.identityAddress,
    path: ["encryption", "1.0", "foo", "bar", "payload.yaml"],
    payload: new TextEncoder().encode("Hello world"),
  }, auth);

  await store.set({
    identity: identity.identityAddress,
    path: ["other", "encryption", "1.0", "foo", "bar", "payload.yaml"],
    payload: new TextEncoder().encode("Hello world"),
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
        key: "",
        recursive: true,
        type: "base64",
      }],
    })),
  }, auth);

  await store.set({
    identity: identity.identityAddress,
    path: ["encryption", "1.0", "foo", "bar", "payload.yaml"],
    payload: new TextEncoder().encode(stringify({
      rules: [{
        key: "",
        recursive: true,
        type: "none",
      }],
    })),
  }, auth);

  let result = await store.getEncryptionSettingsForPath(
    identity.identityAddress,
    [],
    "payload",
  )

  assertEquals(result.rules.length, 1);
  assertEquals(result.rules[0].key, '');
  assertEquals(result.rules[0].type, 'base64');

  result = await store.getEncryptionSettingsForPath(
    identity.identityAddress,
    ["foo", "bar"],
    "payload",
  )

  assertEquals(result.rules.length, 1);
  assertEquals(result.rules[0].key, '');
  assertEquals(result.rules[0].type, 'base64');

  result = await store.getEncryptionSettingsForPath(
    identity.identityAddress,
    ["foo", "bar", "baz"],
    "payload",
  )

  assertEquals(result.rules.length, 1);
  assertEquals(result.rules[0].key, '');
  assertEquals(result.rules[0].type, 'none');
});

Deno.test("Store.encryptPath / base64", async () => {
  const store = newStore();

  await store.set({
    identity: identity.identityAddress,
    path: ["encryption", "1.0", "path.yaml"],
    payload: new TextEncoder().encode(stringify({
      rules: [{
        key: "",
        recursive: true,
        type: "base64",
      }],
    })),
  }, auth);

  const result = await store.encryptPath(
    identity.identityAddress,
    ["foo", "bar"],
  )

  assertEquals(result.length, 2);
  assertEquals(result, ["Zm9v", "YmFy"]);
});

Deno.test("Store.decryptPath / base64", async () => {
  const store = newStore();

  await store.set({
    identity: identity.identityAddress,
    path: ["encryption", "1.0", "path.yaml"],
    payload: new TextEncoder().encode(stringify({
      rules: [{
        key: "",
        recursive: true,
        type: "base64",
      }],
    })),
  }, auth);

  const result = await store.decryptPath(
    identity.identityAddress,
    ["Zm9v", "YmFy"],
  )

  assertEquals(result.length, 2);
  assertEquals(result, ["foo", "bar"]);
});

Deno.test("Store.roundtrip / base64", async () => {
  const store = newStore();

  await store.set({
    identity: identity.identityAddress,
    path: ["encryption", "1.0", "path.yaml"],
    payload: new TextEncoder().encode(stringify({
      rules: [{
        key: "",
        recursive: true,
        type: "base64",
      }],
    })),
  }, auth);

  await store.set({
    identity: identity.identityAddress,
    path: ["encryption", "1.0", "payload.yaml"],
    payload: new TextEncoder().encode(stringify({
      rules: [{
        key: "",
        recursive: true,
        type: "base64",
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
    ["Zm9v"],
  ) as Document

  assert(encryptedResult.payload)
  assertEquals(new TextDecoder().decode(await encryptedResult.payload.bytes()), "YmFy");
});
