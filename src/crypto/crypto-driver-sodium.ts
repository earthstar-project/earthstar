import { ICryptoDriver, KeypairBytes } from "./crypto-types.ts";
import { concatBytes, stringToBytes } from "../util/bytes.ts";
import sodium from "https://deno.land/x/sodium@0.2.0/basic.ts";

await sodium.ready;
const { createHash } = sha256_uint8array;

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
  static async sha256(
    input: string | Uint8Array | ReadableStream<Uint8Array>,
  ): Promise<Uint8Array> {
    if (typeof input === "string") {
      const encoded = new TextEncoder().encode(input);
      const result = await crypto.subtle.digest("SHA-256", encoded);
      return Promise.resolve(new Uint8Array(result));
    } else if (input instanceof Uint8Array) {
      const result = await crypto.subtle.digest("SHA-256", input);
      return Promise.resolve(new Uint8Array(result));
    } else {
      const hash = createHash("sha256");

      const reader = input.getReader();

      while (true) {
        const { value, done } = await reader.read();
        if (value && !done) {
          hash.update(value);
        }

        if (done) {
          return Promise.resolve(hash.digest());
        }
      }
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
