import { meadowcap } from "../src-willow/auth/auth.ts";
import { Crypto } from "../src-willow/crypto/crypto.ts";
import { CryptoDriverWebExtractable } from "../src-willow/crypto/drivers/webcrypto.ts";
import { getStore } from "../src-willow/store/store.ts";
import { isErr } from "../src-willow/util/errors.ts";
const crypto = new Crypto(new CryptoDriverWebExtractable());
const addr = crypto.generateCommunalNamespaceAddress("earthstar");

const identity = await crypto.generateIdentityKeypair("gwil");

if (isErr(identity)) {
  Deno.exit(1);
}

const cap = meadowcap.createCapCommunal({
  accessMode: "write",
  namespace: addr,
  user: identity.identityAddress,
});

const store = getStore(addr);

const result = await store.set(
  {
    path: [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])],
    subspace: identity.identityAddress,
    payload: new TextEncoder().encode("Hello world!"),
  },
  {
    cap,
    receiverSecret: identity.privateKey,
  },
);

console.log(
  identity.identityAddress,
  "tried writing",
  '"Hello world!"',
  "to",
  "/1/2/3",
  "on",
  addr,
);

console.log(result);
