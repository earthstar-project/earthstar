import {
    AuthorAddress,
    AuthorKeypair,
    Base32String,
} from '../util/doc-types';
import {
    ICrypto,
    ICryptoDriver,
    KeypairBytes,
} from './crypto-types';
import {
    ValidationError,
    isErr,
} from '../util/errors';

import { randomId } from '../util/misc';
import {
    base32StringToBytes,
    base32BytesToString
} from './base32';
import {
    decodeAuthorKeypairToBytes,
} from './keypair';
import {
    assembleAuthorAddress,
    checkAuthorIsValid,
    parseAuthorAddress
} from '../core-validators/addresses';

//--------------------------------------------------

import { Logger } from '../util/log';
import { CryptoDriverTweetnacl } from './crypto-driver-tweetnacl';
let logger = new Logger('crypto', 'cyanBright');

//================================================================================

export let GlobalCryptoDriver: ICryptoDriver = CryptoDriverTweetnacl;

export let setGlobalCryptoDriver = (driver: ICryptoDriver): void => {
    logger.debug(`set global crypto driver: ${(driver as any).name}`);
    GlobalCryptoDriver = driver;
}

export const GlobalCrypto: ICrypto = class {
    /**
     * Do a sha256 hash, then return the output bytes encoded as base32.
     */
    static sha256base32(input: string | Uint8Array): Base32String {
        return base32BytesToString(GlobalCryptoDriver.sha256(input));
    }

    /**
     * Generate a new author identity -- a keypair of public and private keys as strings encoded in base32.
     * 
     * NOTE: this will return a different keypair every time, even if the name is the same.
     * (Names are not unique.)
     * 
     * Returns a ValidationError if the name doesn't follow the rules.
     * 
     * @param name A 4-character nickname to make the address easier to remember and identify.
     */
    static generateAuthorKeypair(name: string): AuthorKeypair | ValidationError {
        logger.debug(`generateAuthorKeypair("${name}")`);
        let keypairBytes: KeypairBytes = GlobalCryptoDriver.generateKeypairBytes();
        let keypairFormatted = {
            address: assembleAuthorAddress(name, base32BytesToString(keypairBytes.pubkey)),
            secret: base32BytesToString(keypairBytes.secret),
        };
        // Make sure it's valid (correct length, etc).  return error if invalid.
        let err = checkAuthorIsValid(keypairFormatted.address);
        if (isErr(err)) { return err; }
        return keypairFormatted;
    }

    /**
     * Sign a message using an Earthstar keypair.
     * Return a signature as base32 string.
     * 
     * Can return a ValidationError if the keypair is bad
     * or something goes unexpectedly wrong with signing.
     */
    static sign(keypair: AuthorKeypair, msg: string | Uint8Array): Base32String | ValidationError {
        logger.debug(`sign`);
        try {
            let keypairBytes = decodeAuthorKeypairToBytes(keypair);
            if (isErr(keypairBytes)) { return keypairBytes; }
            return base32BytesToString(GlobalCryptoDriver.sign(keypairBytes, msg));
        } catch (err) {
            /* istanbul ignore next */
            return new ValidationError('unexpected error while signing: ' + err.message);
        }
    }

    /**
     * Check if an author signature is valid.
     * 
     * This returns false on any kind of failure:
     *   * bad author address format
     *   * bad signature base32 format
     *   * signature base32 format is valid but signature itself is invalid
     *   * unexpected failure from crypto library
     */
    static verify(authorAddress: AuthorAddress, sig: Base32String, msg: string | Uint8Array): boolean {
        logger.debug(`verify`);
        try {
            let authorParsed = parseAuthorAddress(authorAddress);
            if (isErr(authorParsed)) { return false; }
            return GlobalCryptoDriver.verify(base32StringToBytes(authorParsed.pubkey), base32StringToBytes(sig), msg);
        } catch (err) {
            // catch any unexpected errors
            /* istanbul ignore next */
            return false;
        }
    }

    /**
     * Check if an author keypair is valid, e.g. does the secret match the pubkey.
     * 
     * Returns...
     * - true on success (format is correct, and secret matches pubkey)
     * - a ValidationError if the secret does not match the pubkey.
     * - a ValidationError if the author address or secret are not validly formatted strings.
     * - a ValidationError if anything else goes wrong
     */
    static checkAuthorKeypairIsValid(keypair: AuthorKeypair): true | ValidationError {
        // We check if the secret matches the pubkey by signing something and then validating the signature.
        // However, key generation is deterministic, so it would be more direct to just do this:
        //
        //     let pubkeyBytes = LowLevelCrypto.generateKeypairBytes(base32StringtoBytes(keypair.secret))
        //     then check if pubkeyBytes matches keypair.address
        //
        // ...but only some of the cryptodrivers let you give a seed for keypair generation.
        // ...so this signature trick will work for now.
        logger.debug(`checkAuthorKeypairIsValid`);
        try {
            if (typeof keypair.address !== 'string' || typeof keypair.secret !== 'string') {
                return new ValidationError('address and secret must be strings');
            }
            let addressErr = checkAuthorIsValid(keypair.address);
            if (isErr(addressErr)) { return addressErr; }

            let msg = 'a test message to sign. ' + randomId();
            let sig = this.sign(keypair, msg);
            if (isErr(sig)) { return sig; }

            let isValid = this.verify(keypair.address, sig, msg);
            if (isValid === false) { return new ValidationError('pubkey does not match secret'); }

            return true;
        } catch (err) {
            /* istanbul ignore next */
            return new ValidationError('unexpected error in checkAuthorKeypairIsValid: ' + err.message);
        }
    };

}
