import { CryptoChloride as LowLevelCrypto } from './cryptoChloride';
//import { CryptoNode as LowLevelCrypto } from './cryptoNode';
export { LowLevelCrypto };

import {
    AuthorAddress,
    AuthorKeypair,
    AuthorShortname,
    EncodedHash,
    EncodedKey,
    EncodedSig,
    ValidationError,
    WorkspaceAddress,
    WorkspaceName,
    isErr,
} from '../util/types';
import {
    KeypairBuffers,
} from './cryptoTypes';
import {
    decodeAuthorKeypair,
    decodePubkey,
    encodePubkey,
    encodeSecret,
} from './encoding';
import {
    ValidatorEs4
} from '../validator/es4';

//================================================================================
// TODO: this really should happen in the validator?

let assembleWorkspaceAddress = (name : WorkspaceName, encodedPubkey : EncodedKey) : WorkspaceAddress =>
    // This doesn't check if it's valid; to do that, parse it and see if parsing has an error.
    `+${name}.${encodedPubkey}`;

let assembleAuthorAddress = (shortname : AuthorShortname, encodedPubkey : EncodedKey) : AuthorAddress =>
    // This doesn't check if it's valid; to do that, parse it and see if parsing has an error.
    `@${shortname}.${encodedPubkey}`;

//================================================================================


export let sha256base32 = (input : string | Buffer) : EncodedHash =>
    LowLevelCrypto.sha256base32(input);

export let generateAuthorKeypair = (shortname : string) : AuthorKeypair | ValidationError => {
    // This returns a ValidationError if the shortname doesn't follow the rules.

    let bufferPair : KeypairBuffers = LowLevelCrypto.generateKeypairBuffers();
    let keypair = {
        address: assembleAuthorAddress(shortname, encodePubkey(bufferPair.pubkey)),
        secret: encodeSecret(bufferPair.secret),
    };
    // Make sure it's valid (correct length, etc).  return error if invalid.
    let err = ValidatorEs4._checkAuthorIsValid(keypair.address);
    if (isErr(err)) { return err; }
    return keypair;
}

export let sign = (keypair : AuthorKeypair, msg : string | Buffer) : EncodedSig | ValidationError => {
    // Returns signature encoded in base32.
    let keypairBuffers = decodeAuthorKeypair(keypair);
    if (isErr(keypairBuffers)) { return keypairBuffers; }
    try {
        return LowLevelCrypto.sign(keypairBuffers, msg);
    } catch (err) {
        return new ValidationError('crash while signing: ' + err.message);
    }
}

export let verify = (authorAddress : AuthorAddress, sig : EncodedSig, msg : string | Buffer) : boolean => {
    // Is the author signature valid?
    // This returns false on any expected kind of failure:
    //    bad author address format
    //    bad signature format (TODO: test this)
    //    signature format is valid but signature itself is invalid
    // If an unexpected exception happens, it is re-thrown.
    try {
        let authorParsed = ValidatorEs4.parseAuthorAddress(authorAddress);
        if (isErr(authorParsed)) { return false; }
        return LowLevelCrypto.verify(decodePubkey(authorParsed.pubkey), sig, msg);
    } catch (err) {
        throw err;
    }
}

export let checkAuthorKeypairIsValid = (keypair : AuthorKeypair) : true | ValidationError => {
    // Returns...
    // true on success (format is correct, and secret matches pubkey)
    // a ValidationError if the secret does not match the pubkey.
    // a ValidationError if the author address or secret are not validly formatted strings.
    // a ValidationError if anything else goes wrong
    //
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
        let addressErr = ValidatorEs4._checkAuthorIsValid(keypair.address);
        if (isErr(addressErr)) { return addressErr; }

        let msg = 'a test message to sign';
        let sig = sign(keypair, msg);
        if (isErr(sig)) { return sig; }

        let isValid = verify(keypair.address, sig, msg);

        if (isValid === false) { return new ValidationError('pubkey does not match secret'); }
        return true;
    } catch (err) {
        return new ValidationError('unexpected error: ' + err.message);
    }
}
