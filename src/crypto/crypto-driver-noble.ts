// This is because we are using non-default lib in compiler options
// https://github.com/denoland/deno/issues/12754

declare global {
    interface Crypto {
        randomUUID: () => string;
    }
}

import { ICryptoDriver, KeypairBytes } from "./crypto-types.ts";
import { stringToBytes } from "../util/bytes.ts";
import { sha256_uint8array } from "../../deps.ts";
import * as ed from "../noble-ed25519/noble-ed25519.ts";

const { createHash } = sha256_uint8array;

//--------------------------------------------------

import { Logger } from "../util/log.ts";
let logger = new Logger("crypto-driver-noble", "cyan");

//================================================================================
/**
 * A verison of the ILowLevelCrypto interface backed by noble/ed25519.
 * Works in the browser.
 */
export const CryptoDriverNoble: ICryptoDriver = class {
    static async sha256(input: string | Uint8Array): Promise<Uint8Array> {
        if (typeof input === "string") {
            return createHash("sha256").update(input, "utf-8").digest();
        } else {
            return createHash("sha256").update(input).digest();
        }
    }
    static async generateKeypairBytes(): Promise<KeypairBytes> {
        logger.debug("generateKeypairBytes");
        let secret = ed.utils.randomPrivateKey();
        let pubkey = await ed.getPublicKey(secret);

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
        } catch (e) {
            /* istanbul ignore next */
            return false;
        }
    }
};
