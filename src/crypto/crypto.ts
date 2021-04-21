import { CryptoDriverNode as CryptoDriver } from './crypto-driver-node';
export { CryptoDriver };

import {
    AuthorAddress,
    AuthorKeypair,
    Base32String,
} from '../types/doc-types';
import {
    KeypairBuffers,
} from '../types/crypto-types';
import {
    ValidationError,
    isErr,
} from '../util/errors';
import {
    base32StringToBuffer,
    bufferToBase32String
} from '../base32';
import {
    decodeAuthorKeypair,
} from './keypair';
import {
    assembleAuthorAddress,
    checkAuthorIsValid,
    parseAuthorAddress
} from '../core-validators/addresses';

//================================================================================

/** Do a sha256 hash, then return the output buffer encoded as base32. */
export let sha256base32 = (input: string | Buffer): Base32String =>
    bufferToBase32String(CryptoDriver.sha256(input));

/**
 * Generate a new author identity -- a keypair of public and private keys.
 * 
 * NOTE: this will return a different keypair every time, even if the shortname is the same.
 * Shortnames are not unique.
 * 
 * @param shortname A 4-character nickname to make the address easier to remember and identify.
 */
export let generateAuthorKeypair = (shortname: string): AuthorKeypair | ValidationError => {
    // This returns a ValidationError if the shortname doesn't follow the rules.

    let bufferPair: KeypairBuffers = CryptoDriver.generateKeypairBuffers();
    let keypair = {
        address: assembleAuthorAddress(shortname, bufferToBase32String(bufferPair.pubkey)),
        secret: bufferToBase32String(bufferPair.secret),
    };
    // Make sure it's valid (correct length, etc).  return error if invalid.
    let err = checkAuthorIsValid(keypair.address);
    if (isErr(err)) { return err; }
    return keypair;
}

/** Sign a message using an Earthstar keypair.  Return a signature encoded in base32. */
export let sign = (keypair: AuthorKeypair, msg: string | Buffer): Base32String | ValidationError => {
    try {
        let keypairBuffers = decodeAuthorKeypair(keypair);
        if (isErr(keypairBuffers)) { return keypairBuffers; }
        return bufferToBase32String(CryptoDriver.sign(keypairBuffers, msg));
    } catch (err) {
        return new ValidationError('unexpected error while signing: ' + err.message);
    }
}

/**
 * Check if an author signature is valid.
 * 
 * This returns false on any expected kind of failure:
 *   * bad author address format
 *   * bad signature format (TODO: test this)
 *   * signature format is valid but signature itself is invalid
 * 
 * If an unexpected exception happens, it is re-thrown.
 */
export let verify = (authorAddress: AuthorAddress, sig: Base32String, msg: string | Buffer): boolean => {
    try {
        let authorParsed = parseAuthorAddress(authorAddress);
        if (isErr(authorParsed)) { return false; }
        return CryptoDriver.verify(base32StringToBuffer(authorParsed.pubkey), base32StringToBuffer(sig), msg);
    } catch (err) {
        // base32StringToBuffer can throw a validation error -- catch that.
        // the crypto code might also throw any kind of error.
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
export let checkAuthorKeypairIsValid = (keypair: AuthorKeypair): true | ValidationError => {
    // We check if the secret matches the pubkey by signing something and then validating the signature.
    // However, key generation is deterministic, so it would be more direct to just do this:
    //
    //     let pubkeyBuffer = LowLevelCrypto.generateKeypairBuffers(base32toBuffer(keypair.secret))
    //     then check if pubkeyBuffer matches keypair.address
    //
    // ...but this signature trick will work for now.
    try {
        if (typeof keypair.address !== 'string' || typeof keypair.secret !== 'string') {
            return new ValidationError('address and secret must be strings');
        }
        let addressErr = checkAuthorIsValid(keypair.address);
        if (isErr(addressErr)) { return addressErr; }

        let msg = 'a test message to sign. ' + Math.random();
        let sig = sign(keypair, msg);
        if (isErr(sig)) { return sig; }

        let isValid = verify(keypair.address, sig, msg);
        if (isValid === false) { return new ValidationError('pubkey does not match secret'); }

        return true;
    } catch (err) {
        return new ValidationError('unexpected error in checkAuthorKeypairIsValid: ' + err.message);
    }
};

