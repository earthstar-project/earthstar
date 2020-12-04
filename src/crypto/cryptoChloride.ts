import crypto = require('crypto');
import sodium = require('chloride')
import {
    ILowLevelCrypto,
    KeypairBuffers,
} from './cryptoTypes';
import {
    decodeSig,
    encodeSig,
} from './encoding';
import {
    EncodedSig,
} from '../util/types';

/**
 * A verison of the ILowLevelCrypto interface backed by Chloride.
 * Works in the browser.
 */
export const CryptoChloride: ILowLevelCrypto = class {
    static sha256(input: string | Buffer): Buffer {
        // TODO: use sodium sha256 instead of node crypto?
        return crypto.createHash('sha256').update(input).digest();
    }
    static generateKeypairBuffers(seed?: Buffer): KeypairBuffers {
        // If provided, the seed is used as the secret key.
        // If omitted, a random secret key is generated.
        if (!seed) {
            seed = Buffer.alloc(32);
            sodium.randombytes(seed);
        }
        let keys = sodium.crypto_sign_seed_keypair(seed);
        return {
            //curve: 'ed25519',
            pubkey: keys.publicKey,
            // so that this works with either sodium or libsodium-wrappers (in browser):
            secret: (keys.privateKey || keys.secretKey).slice(0, 32),
        };
    };
    static sign(keypair: KeypairBuffers, msg: string | Buffer): EncodedSig {
        // Return the signature encoded from binary into base32
        let secretBuf = Buffer.concat([keypair.secret, keypair.pubkey]);
        if (typeof msg === 'string') { msg = Buffer.from(msg, 'utf8'); }
        return encodeSig(
            // this returns a Buffer
            sodium.crypto_sign_detached(msg, secretBuf)
        );
    }
    static verify(publicKey: Buffer, sig: EncodedSig, msg: string | Buffer): boolean {
        try {
            if (typeof msg === 'string') { msg = Buffer.from(msg, 'utf8'); }
            return sodium.crypto_sign_verify_detached(
                decodeSig(sig),
                msg,
                publicKey,
            );
        } catch (e) {
            return false;
        }
    }
};
