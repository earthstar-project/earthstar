import crypto = require('crypto');
import sodium = require('chloride')
import {
    ICryptoDriver,
    KeypairBytes,
} from '../types/crypto-types';
import {
    bufferToBytes,
    bytesToBuffer,
    concatBytes,
    stringToBuffer
} from '../util/bytes';

console.log('-----------------------');
console.log(sodium);
console.log('-----------------------');

/**
 * A verison of the ILowLevelCrypto interface backed by Chloride.
 * Works in the browser.
 */
export const CryptoDriverChloride: ICryptoDriver = class {
    static sha256(input: string | Uint8Array): Uint8Array {
        // TODO: use sodium sha256 instead of node crypto?
        return bufferToBytes(
            crypto.createHash('sha256').update(input).digest()
        );
    }
    static generateKeypairBytes(seed?: Uint8Array): KeypairBytes {
        // If provided, the seed is used as the secret key.
        // If omitted, a random secret key is generated.
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
            secret: bufferToBytes((keys.privateKey || keys.secretKey).slice(0, 32)),
        };
    };
    static sign(keypair: KeypairBytes, msg: string | Uint8Array): Uint8Array {
        let secretBuf = bytesToBuffer(concatBytes(keypair.secret, keypair.pubkey));
        if (typeof msg === 'string') { msg = stringToBuffer(msg); }
        if (msg instanceof Uint8Array) { msg = bytesToBuffer(msg); }
        return bufferToBytes(
            // this returns a Buffer
            sodium.crypto_sign_detached(msg, secretBuf)
        );
    }
    static verify(publicKey: Buffer, sig: Uint8Array, msg: string | Uint8Array): boolean {
        try {
            if (typeof msg === 'string') { msg = stringToBuffer(msg); }
            if (msg instanceof Uint8Array) { msg = bytesToBuffer(msg); }
            return sodium.crypto_sign_verify_detached(
                bytesToBuffer(sig),
                msg,
                publicKey,
            );
        } catch (e) {
            return false;
        }
    }
};
