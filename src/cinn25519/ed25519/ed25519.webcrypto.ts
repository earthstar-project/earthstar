import { decodeBase64Url, encodeBase64Url } from "@std/encoding/base64url";
import { Ed25519Driver } from "../types.ts";

export class Ed25519webcrypto implements Ed25519Driver<Uint8Array> {
  async generateKeypair(): Promise<
    { publicKey: Uint8Array; secretKey: Uint8Array }
  > {
    const { publicKey, privateKey } = await crypto.subtle.generateKey(
      "Ed25519",
      true,
      ["sign", "verify"],
    ) as CryptoKeyPair;

    const pubkeyBuffer = await crypto.subtle.exportKey("raw", publicKey);
    const privateKeyJwk = await crypto.subtle.exportKey("jwk", privateKey);

    // This is the secret key
    const privateKeyFromJkw = decodeBase64Url(privateKeyJwk.d!);

    return {
      publicKey: new Uint8Array(pubkeyBuffer),
      secretKey: privateKeyFromJkw,
    };
  }

  async sign(bytes: Uint8Array, secretKey: Uint8Array): Promise<Uint8Array> {
    const imported = await crypto.subtle.importKey(
      "jwk",
      {
        kty: "OKP",
        crv: "Ed25519",
        key_ops: ["sign"],
        ext: true,
        d: encodeBase64Url(secretKey),
      },
      { name: "Ed25519" },
      true,
      ["sign"],
    );

    const sig = await crypto.subtle.sign(
      { name: "Ed25519" },
      imported,
      bytes,
    );

    return new Uint8Array(sig);
  }

  async verify(
    publicKey: Uint8Array,
    signature: Uint8Array,
    bytes: Uint8Array,
  ): Promise<boolean> {
    const pubkey = await crypto.subtle.importKey(
      "raw",
      publicKey,
      { name: "Ed25519" },
      true,
      ["verify"],
    );

    return crypto.subtle.verify(
      { name: "Ed25519" },
      pubkey,
      signature,
      bytes,
    );
  }
}
