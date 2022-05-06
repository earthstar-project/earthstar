import { ICryptoDriver, KeypairBytes } from "./crypto-types.ts";
import { concatBytes, stringToBytes } from "../util/bytes.ts";
import sodium from "https://deno.land/x/sodium@0.2.0/basic.ts";

const { createHash } = sha256_uint8array;

await sodium.ready;

//--------------------------------------------------

import { Logger } from "../util/log.ts";
import { sha256_uint8array } from "../../deps.ts";
const logger = new Logger("crypto-driver-noble", "cyan");

//================================================================================
/**
 * A verison of the ILowLevelCrypto interface backed by noble/ed25519.
 * Works in the browser.
 */
export const CryptoDriverSodium: ICryptoDriver = class {
  static sha256(input: string | Uint8Array): Promise<Uint8Array> {
    if (typeof input === "string") {
      return Promise.resolve(
        createHash("sha256").update(input, "utf-8").digest(),
      );
    } else {
      return Promise.resolve(createHash("sha256").update(input).digest());
    }
  }
  static generateKeypairBytes(): Promise<KeypairBytes> {
    logger.debug("generateKeypairBytes");

    const seed = sodium.randombytes_buf(32);
    const keys = sodium.crypto_sign_seed_keypair(seed);

    return Promise.resolve({
      pubkey: keys.publicKey,
      secret: keys.privateKey.slice(0, 32),
    });
  }
  static sign(
    keypairBytes: KeypairBytes,
    msg: string | Uint8Array,
  ): Promise<Uint8Array> {
    logger.debug("sign");
    if (typeof msg === "string") msg = stringToBytes(msg);

    const identity = concatBytes(keypairBytes.secret, keypairBytes.pubkey);

    return Promise.resolve(sodium.crypto_sign_detached(msg, identity));
  }
  static verify(
    publicKey: Uint8Array,
    sig: Uint8Array,
    msg: string | Uint8Array,
  ): Promise<boolean> {
    logger.debug("verify");
    try {
      if (typeof msg === "string") msg = stringToBytes(msg);

      const verified = sodium.crypto_sign_verify_detached(
        sig,
        msg,
        publicKey,
      );

      return Promise.resolve(verified);
    } catch {
      return Promise.resolve(false);
    }
  }
};
