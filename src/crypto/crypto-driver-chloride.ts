import { default as sodium } from "../node/chloride.ts";
import { Buffer } from "https://deno.land/std@0.119.0/node/buffer.ts";
import { ICryptoDriver, KeypairBytes } from "./crypto-types.ts";
import { concatBytes, identifyBufOrBytes } from "../util/bytes.ts";
import {
    bufferToBytes,
    bytesToBuffer,
    stringToBuffer,
} from "../util/buffers.ts";

//--------------------------------------------------

import { Logger, LogLevel, setLogLevel } from "../util/log.ts";
let logger = new Logger("crypto-driver-chloride", "cyan");

setLogLevel("crypto-driver-chloride", LogLevel.Info);

//================================================================================

/*
export let waitUntilChlorideIsReady = async () => {
    logger.info('waiting for chloride to become ready...');
    // TODO: how to do this properly?
    // https://github.com/jedisct1/libsodium.js#usage-as-a-module
    await sleep(2000);
}
*/

/**
 * A verison of the ILowLevelCrypto interface backed by Chloride.
 * Works in the browser.
 */
export const CryptoDriverChloride: ICryptoDriver = class {
    static async sha256(input: string | Buffer): Promise<Uint8Array> {
        if (typeof input === "string") input = stringToBuffer(input);
        if (identifyBufOrBytes(input) === "bytes") input = bytesToBuffer(input);
        let resultBuf = sodium.crypto_hash_sha256(input);
        return bufferToBytes(resultBuf);
    }
    static async generateKeypairBytes(
        seed?: Uint8Array,
    ): Promise<KeypairBytes> {
        // If provided, the seed is used as the secret key.
        // If omitted, a random secret key is generated.
        logger.debug("generateKeypairBytes");
        let seedBuf = seed === undefined ? undefined : bytesToBuffer(seed);
        if (!seedBuf) {
            seedBuf = Buffer.alloc(32);
            sodium.randombytes(seedBuf);
        }
        let keys = sodium.crypto_sign_seed_keypair(seedBuf);
        return {
            //curve: 'ed25519',
            pubkey: bufferToBytes(keys.publicKey),
            // so that this works with either sodium or libsodium-wrappers (in browser):
            secret: bufferToBytes((keys.secretKey).slice(0, 32)),
        };
    }
    static async sign(
        keypairBytes: KeypairBytes,
        msg: string | Buffer,
    ): Promise<Uint8Array> {
        logger.debug("sign");
        let secretBuf = bytesToBuffer(
            concatBytes(keypairBytes.secret, keypairBytes.pubkey),
        );
        if (typeof msg === "string") msg = stringToBuffer(msg);
        if (msg instanceof Uint8Array) msg = bytesToBuffer(msg);
        return bufferToBytes(
            // this returns a Buffer
            sodium.crypto_sign_detached(msg, secretBuf),
        );
    }
    static async verify(
        publicKey: Buffer,
        sig: Uint8Array,
        msg: string | Buffer,
    ): Promise<boolean> {
        logger.debug("verify");
        try {
            if (typeof msg === "string") msg = stringToBuffer(msg);
            if (msg instanceof Uint8Array) msg = bytesToBuffer(msg);
            return sodium.crypto_sign_verify_detached(
                bytesToBuffer(sig),
                msg,
                publicKey,
            ) as unknown as boolean;
        } catch (e) {
            /* istanbul ignore next */
            return false;
        }
    }
};
