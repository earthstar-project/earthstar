import { Ed25519Driver } from "../types.ts";

export class Ed25519 implements Ed25519Driver<CryptoKey> {
  async generateKeypair(): Promise<
    { publicKey: Uint8Array; secretKey: CryptoKey }
  > {
    const { publicKey, privateKey } = await crypto.subtle.generateKey(
      "Ed25519",
      false,
      ["sign", "verify"],
    ) as CryptoKeyPair;

    const pubkeyBuffer = await crypto.subtle.exportKey("raw", publicKey);

    return {
      publicKey: new Uint8Array(pubkeyBuffer),
      secretKey: privateKey,
    };
  }

  async sign(bytes: Uint8Array, secretKey: CryptoKey): Promise<Uint8Array> {
    const sig = await crypto.subtle.sign(
      { name: "Ed25519" },
      secretKey,
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
