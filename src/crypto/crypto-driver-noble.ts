import { ICryptoDriver, KeypairBytes } from "./crypto-types.ts";
import { stringToBytes } from "../util/bytes.ts";
import { ed, sha256_uint8array } from "../../deps.ts";

const { createHash } = sha256_uint8array;

//--------------------------------------------------

import { Logger } from "../util/log.ts";
import { UpdatableHash } from "./updatable_hash.ts";
const logger = new Logger("crypto-driver-noble", "cyan");

//================================================================================
/**
 * A verison of the ILowLevelCrypto interface backed by noble/ed25519.
 * Works in the browser.
 */
export const CryptoDriverNoble: ICryptoDriver = class {
  static sha256(
    input: string | Uint8Array,
  ): Promise<Uint8Array> {
    if (typeof input === "string") {
      return Promise.resolve(
        createHash("sha256").update(input, "utf-8").digest(),
      );
    } else {
      return Promise.resolve(createHash("sha256").update(input).digest());
    }
  }

  static updatableSha256() {
    return new UpdatableHash({
      hash: createHash("sha256"),
      update: (hash, data) => hash.update(data),
      digest: (hash) => hash.digest(),
    });
  }

  static async generateKeypairBytes(): Promise<KeypairBytes> {
    logger.debug("generateKeypairBytes");
    const secret = ed.utils.randomPrivateKey();
    const pubkey = await ed.getPublicKey(secret);

    return {
      pubkey,
      secret,
    };
  }
  static sign(
    keypairBytes: KeypairBytes,
    msg: string | Uint8Array,
  ): Promise<Uint8Array> {
    logger.debug("sign");
    if (typeof msg === "string") msg = stringToBytes(msg);
    return ed.sign(msg, keypairBytes.secret);
  }
  static async verify(
    publicKey: Uint8Array,
    sig: Uint8Array,
    msg: string | Uint8Array,
  ): Promise<boolean> {
    logger.debug("verify");
    try {
      if (typeof msg === "string") msg = stringToBytes(msg);
      const result = await ed.verify(sig, msg, publicKey);
      return result;
    } catch {
      return false;
    }
  }
};
