import * as ed from "https://esm.sh/@noble/ed25519@2.0.0";
import { CryptoDriver } from "../types.ts";

export class CryptoDriverNoble implements CryptoDriver<Uint8Array> {
  async generateKeypair(): Promise<
    { publicKey: Uint8Array; privateKey: Uint8Array }
  > {
    const privateKey = ed.utils.randomPrivateKey();
    const publicKey = await ed.getPublicKeyAsync(privateKey);

    return { publicKey, privateKey };
  }

  sign(bytes: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
    return ed.signAsync(bytes, privateKey);
  }

  verify(
    publicKey: Uint8Array,
    signature: Uint8Array,
    bytes: Uint8Array,
  ): Promise<boolean> {
    return ed.verifyAsync(signature, bytes, publicKey);
  }
}
