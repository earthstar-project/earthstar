import tweetnacl from 'tweetnacl';
import {
    ICryptoDriver,
    KeypairBytes,
} from './crypto-types';
import {
    concatBytes,   
    stringToBytes
} from '../util/bytes';
import { createHash } from 'sha256-uint8array';

/**
 * A verison of the ILowLevelCrypto interface backed by Chloride.
 * Works in the browser.
 */
export const CryptoDriverTweetnacl: ICryptoDriver = class {
    static sha256(input: string | Uint8Array): Uint8Array {
        if (typeof input === 'string') {
            return createHash('sha256').update(input, 'utf-8').digest()
        } else {
            return createHash('sha256').update(input).digest()
        }
    }
    static generateKeypairBytes(): KeypairBytes {
        let keys = tweetnacl.sign.keyPair();
        return {
            pubkey: keys.publicKey,
            secret: (keys.secretKey).slice(0, 32),
        };
    };
    static sign(keypairBytes: KeypairBytes, msg: string | Uint8Array): Uint8Array {
        let secret = concatBytes(keypairBytes.secret, keypairBytes.pubkey);
        if (typeof msg === 'string') { msg = stringToBytes(msg); }
        return tweetnacl.sign.detached(msg, secret);
    }
    static verify(publicKey: Buffer, sig: Uint8Array, msg: string | Uint8Array): boolean {
        try {
            if (typeof msg === 'string') { msg = stringToBytes(msg); }
            return tweetnacl.sign.detached.verify(msg, sig, publicKey);
        } catch (e) {
            return false;
        }
    }
};
