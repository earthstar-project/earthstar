import { CryptoDriver } from "../types.ts";

export class CryptoDriverWebNonExtractable implements CryptoDriver<CryptoKey> {
  async generateKeypair(): Promise<
    { publicKey: Uint8Array; privateKey: CryptoKey }
  > {
    const { publicKey, privateKey } = await crypto.subtle.generateKey(
      "Ed25519",
      false,
      ["sign", "verify"],
    ) as CryptoKeyPair;

    const pubkeyBuffer = await crypto.subtle.exportKey("raw", publicKey);

    return {
      publicKey: new Uint8Array(pubkeyBuffer),
      privateKey: privateKey,
    };
  }

  async sign(bytes: Uint8Array, privateKey: CryptoKey): Promise<Uint8Array> {
    const sig = await crypto.subtle.sign(
      { name: "Ed25519" },
      privateKey,
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
      true, /* extractable */
      ["deriveKey", "deriveBits"],
    );

    return crypto.subtle.verify(
      { name: "Ed25519" },
      pubkey,
      signature,
      bytes,
    );
  }
}

export class CryptoDriverWebExtractable implements CryptoDriver<JsonWebKey> {
  async generateKeypair(): Promise<
    { publicKey: Uint8Array; privateKey: JsonWebKey }
  > {
    const { publicKey, privateKey } = await crypto.subtle.generateKey(
      "Ed25519",
      true,
      ["sign", "verify"],
    ) as CryptoKeyPair;

    const pubkeyBuffer = await crypto.subtle.exportKey("raw", publicKey);
    const privateKeyJwk = await crypto.subtle.exportKey("jwk", privateKey);

    return {
      publicKey: new Uint8Array(pubkeyBuffer),
      privateKey: privateKeyJwk,
    };
  }

  async sign(bytes: Uint8Array, privateKey: JsonWebKey): Promise<Uint8Array> {
    const imported = await crypto.subtle.importKey(
      "jwk",
      privateKey,
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
      true, /* extractable */
      ["deriveKey", "deriveBits"],
    );

    return crypto.subtle.verify(
      { name: "Ed25519" },
      pubkey,
      signature,
      bytes,
    );
  }
}
