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

//--------------------------------------------------

import { Logger } from '../util/log';
let logger = new Logger('crypto-driver-tweetnacl', 'cyan');

//================================================================================
/**
 * A verison of the ILowLevelCrypto interface backed by TweetNaCl.
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
        logger.debug('generateKeypairBytes');
        let keys = tweetnacl.sign.keyPair();
        return {
            pubkey: keys.publicKey,
            secret: (keys.secretKey).slice(0, 32),
        };
    };
    static sign(keypairBytes: KeypairBytes, msg: string | Uint8Array): Uint8Array {
        logger.debug('sign');
        let secret = concatBytes(keypairBytes.secret, keypairBytes.pubkey);
        if (typeof msg === 'string') { msg = stringToBytes(msg); }
        return tweetnacl.sign.detached(msg, secret);
    }
    static verify(publicKey: Buffer, sig: Uint8Array, msg: string | Uint8Array): boolean {
        logger.debug('verify');
        try {
            if (typeof msg === 'string') { msg = stringToBytes(msg); }
            return tweetnacl.sign.detached.verify(msg, sig, publicKey);
        } catch (e) {
            /* istanbul ignore next */
            return false;
        }
    }
};
