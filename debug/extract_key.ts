import { decodeBase64Url } from "https://deno.land/std@0.218.2/encoding/base64url.ts";

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  "Ed25519",
  true,
  ["sign", "verify"],
);

const pubkeyBuffer = await crypto.subtle.exportKey("raw", publicKey);
const privateKeyJwk = await crypto.subtle.exportKey("jwk", privateKey);

// This is the secret key
console.log(privateKeyJwk);
console.log(decodeBase64Url(privateKeyJwk.d));

const res = await crypto.subtle.importKey(
  "jwk",
  {
    kty: "OKP",
    crv: "Ed25519",
    //  x: "FXLWAkkEU_HL5VuVbwMnSlJ_pndOxzSnUvpIf75do_I",
    key_ops: ["sign"],
    ext: true,
    d: "WiRwfQ8PrfGhuKVw9eq0cp3yFj8ftJHMU1cRV_8S2yk",
  },
  { name: "Ed25519" },
  true,
  ["sign"],
);

console.log(res);
