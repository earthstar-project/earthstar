// This file has no type annotations because we can't get the typings for Node's crypto library here.

import crypto from "https://deno.land/std@0.119.0/node/crypto.ts";

import { b64StringToBytes, concatBytes } from "../util/bytes.ts";
import { bufferToBytes, bytesToBuffer, stringToBuffer } from "../util/buffers.ts";

//--------------------------------------------------

import { Logger } from "../util/log.ts";
let logger = new Logger("crypto-driver-node", "cyan");

//================================================================================

const _generateKeypairDerBytes = () => {
    // Generate a keypair in "der" format, which we will have to process
    // to remove some prefixes.
    //
    // Typescript has outdated definitions, doesn't know about ed25519.
    // So fight it with "as any".
    let pair = crypto.generateKeyPairSync(
        "ed25519",
        {
            publicKeyEncoding: {
                format: "der",
                type: "spki",
            },
            privateKeyEncoding: {
                format: "der",
                type: "pkcs8",
            },
        },
    );
    // Typescript thinks these are strings, but they're Buffers...
    // and we need to convert them to bytes (uint8arrays)
    return {
        pubkey: bufferToBytes(pair.publicKey),
        secret: bufferToBytes(pair.privateKey),
    };
};

function _shortenDer(k) {
    return ({
        pubkey: k.pubkey.slice(-32),
        secret: k.secret.slice(-32),
    });
}
let _derPrefixPublic = b64StringToBytes("MCowBQYDK2VwAyEA");
let _derPrefixSecret = b64StringToBytes("MC4CAQAwBQYDK2VwBCIEIA==");
function _lengthenDerPublic(b) {
    return concatBytes(_derPrefixPublic, b);
}
function _lengthenDerSecret(b) {
    return concatBytes(_derPrefixSecret, b);
}

/**
 * A verison of the ILowLevelCrypto interface backed by native Node crypto functions.
 * Requires a recent version of Node, perhaps 12+?
 * Does not work in the browser.
 */
export const CryptoDriverNode = class {
    static async sha256(input) {
        return bufferToBytes(
            crypto.createHash("sha256").update(input).digest(),
        );
    }
    static async generateKeypairBytes() {
        logger.debug("generateKeypairBytes");
        return _shortenDer(_generateKeypairDerBytes());
    }
    static async sign(keypairBytes, msg) {
        logger.debug("sign");
        if (typeof msg === "string") msg = stringToBuffer(msg);
        return bufferToBytes(crypto.sign(
            null,
            msg,
            {
                key: bytesToBuffer(_lengthenDerSecret(keypairBytes.secret)),
                format: "der",
                type: "pkcs8",
            },
        ));
    }
    static async verify(publicKey, sig, msg) {
        logger.debug("verif");
        // TODO: convert uint8arrays to Buffers?
        if (typeof msg === "string") msg = stringToBuffer(msg);
        try {
            return crypto.verify(
                null,
                msg,
                {
                    key: _lengthenDerPublic(publicKey),
                    format: "der",
                    type: "spki",
                },
                sig,
            );
        } catch (e) {
            /* istanbul ignore next */
            return false;
        }
    }
};
