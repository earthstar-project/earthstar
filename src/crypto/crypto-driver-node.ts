import crypto = require('crypto');

import {
    ICryptoDriver,
    KeypairBytes,
} from '../types/crypto-types';
import {
    b64StringToBytes,
    bufferToBytes,
    bytesToBuffer,
    concatBytes,
    stringToBuffer
} from '../util/bytes';

const _generateKeypairDerBytes = (): KeypairBytes => {
    // Generate a keypair in "der" format, which we will have to process
    // to remove some prefixes.
    //
    // Typescript has outdated definitions, doesn't know about ed25519.
    // So fight it with "as any".
    let pair = crypto.generateKeyPairSync(
        'ed25519' as any,
        {
            publicKeyEncoding: {
                format: 'der',
                type: 'spki',
            },
            privateKeyEncoding: {
                format: 'der',
                type: 'pkcs8',
            },
        } as any
    );
    // Typescript thinks these are strings, but they're Buffers...
    // and we need to convert them to bytes (uint8arrays)
    return {
        pubkey: bufferToBytes(pair.publicKey as any as Buffer),
        secret: bufferToBytes(pair.privateKey as any as Buffer),
    };
};

let _shortenDer = (k: KeypairBytes): KeypairBytes => ({
    pubkey: k.pubkey.slice(-32),
    secret: k.secret.slice(-32),
});
let _derPrefixPublic = b64StringToBytes('MCowBQYDK2VwAyEA');
let _derPrefixSecret = b64StringToBytes('MC4CAQAwBQYDK2VwBCIEIA==');
let _lengthenDerPublic = (b: Uint8Array): Uint8Array =>
    concatBytes(_derPrefixPublic, b);
let _lengthenDerSecret = (b: Uint8Array): Uint8Array =>
    concatBytes(_derPrefixSecret, b);

/**
 * A verison of the ILowLevelCrypto interface backed by native Node crypto functions.
 * Requires a recent version of Node, perhaps 12+?
 * Does not work in the browser.
 */
export const CryptoDriverNode: ICryptoDriver = class {
    static sha256(input: string | Uint8Array): Uint8Array {
        return bufferToBytes(
            crypto.createHash('sha256').update(input).digest()
        );
    }
    static generateKeypairBytes(): KeypairBytes {
        return _shortenDer(_generateKeypairDerBytes());
    };
    static sign(keypairBytes: KeypairBytes, msg: string | Uint8Array): Uint8Array {
        if (typeof msg === 'string') { msg = stringToBuffer(msg); }
        return bufferToBytes(crypto.sign(
            null,
            msg,
            {
                key: bytesToBuffer(_lengthenDerSecret(keypairBytes.secret)),
                format: 'der',
                type: 'pkcs8',
            }
        ));
    }
    static verify(publicKey: Uint8Array, sig: Uint8Array, msg: string | Uint8Array): boolean {
        // TODO: convert uint8arrays to Buffers?
        if (typeof msg === 'string') { msg = stringToBuffer(msg); }
        try {
            return crypto.verify(
                null,
                msg,
                {
                    key: _lengthenDerPublic(publicKey),
                    format: 'der',
                    type: 'spki',
                } as any,
                sig,
            );
        } catch (e) {
            return false;
        }
    }
};
