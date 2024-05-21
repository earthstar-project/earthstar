import * as ed from "@noble/ed25519";
import type { Ed25519Driver } from "../types.ts";

export class Ed25519noble implements Ed25519Driver<Uint8Array> {
  async generateKeypair(): Promise<
    { publicKey: Uint8Array; secretKey: Uint8Array }
  > {
    const secretKey = ed.utils.randomPrivateKey();
    const publicKey = await ed.getPublicKeyAsync(secretKey);

    return { publicKey, secretKey };
  }

  sign(bytes: Uint8Array, secretKey: Uint8Array): Promise<Uint8Array> {
    return ed.signAsync(bytes, secretKey);
  }

  verify(
    publicKey: Uint8Array,
    signature: Uint8Array,
    bytes: Uint8Array,
  ): Promise<boolean> {
    return ed.verifyAsync(signature, bytes, publicKey);
  }
}
