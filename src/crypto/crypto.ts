import { CryptoDriverChloride } from './crypto-driver-chloride';
import { CryptoDriverNode } from './crypto-driver-node';
import { CryptoDriverTweetnacl } from './crypto-driver-tweetnacl';

import { isNode } from 'browser-or-node';
let CryptoDriver: ICryptoDriver;
if (isNode && process.version >= 'v12') {
    CryptoDriver = CryptoDriverNode;
} else {
    CryptoDriver = CryptoDriverTweetnacl;
}

import {
    AuthorAddress,
    AuthorKeypair,
    Base32String,
} from '../util/doc-types';
import {
    ICryptoDriver,
    KeypairBytes,
} from './crypto-types';
import {
    ValidationError,
    isErr,
} from '../util/errors';
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

//================================================================================

/** Do a sha256 hash, then return the output bytes encoded as base32. */
export let sha256base32 = (input: string | Uint8Array): Base32String =>
    base32BytesToString(CryptoDriver.sha256(input));

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

    let keypairBytes: KeypairBytes = CryptoDriver.generateKeypairBytes();
    let keypairFormatted = {
        address: assembleAuthorAddress(shortname, base32BytesToString(keypairBytes.pubkey)),
        secret: base32BytesToString(keypairBytes.secret),
    };
    // Make sure it's valid (correct length, etc).  return error if invalid.
    let err = checkAuthorIsValid(keypairFormatted.address);
    if (isErr(err)) { return err; }
    return keypairFormatted;
}

/** Sign a message using an Earthstar keypair.  Return a signature encoded in base32. */
export let sign = (keypair: AuthorKeypair, msg: string | Uint8Array): Base32String | ValidationError => {
    try {
        let keypairBytes = decodeAuthorKeypairToBytes(keypair);
        if (isErr(keypairBytes)) { return keypairBytes; }
        return base32BytesToString(CryptoDriver.sign(keypairBytes, msg));
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
export let verify = (authorAddress: AuthorAddress, sig: Base32String, msg: string | Uint8Array): boolean => {
    try {
        let authorParsed = parseAuthorAddress(authorAddress);
        if (isErr(authorParsed)) { return false; }
        return CryptoDriver.verify(base32StringToBytes(authorParsed.pubkey), base32StringToBytes(sig), msg);
    } catch (err) {
        // base32 conversion can throw a validation error -- catch that.
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
    //     let pubkeyBytes = LowLevelCrypto.generateKeypairBytes(base32StringtoBytes(keypair.secret))
    //     then check if pubkeyBytes matches keypair.address
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

