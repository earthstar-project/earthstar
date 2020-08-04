import { CryptoChloride as LowLevelCrypto } from './cryptoChloride';
//import { CryptoNode as LowLevelCrypto } from './cryptoNode';
export { LowLevelCrypto };

import {
    AuthorAddress,
    AuthorKeypair,
    EncodedHash,
    EncodedSig,
    WorkspaceName,
    EncodedKey,
    WorkspaceAddress,
    AuthorShortname,
    ValidationError,
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
    ValidatorNew_Es4
} from '../validator/es4';

//================================================================================
// this really should happen in the validator?

let assembleWorkspaceAddress = (name : WorkspaceName, encodedPubkey : EncodedKey) : WorkspaceAddress =>
    // This doesn't check if it's valid; to do that, parse it and see if parsing has an error.
    `+${name}.${encodedPubkey}`;

let assembleAuthorAddress = (shortname : AuthorShortname, encodedPubkey : EncodedKey) : AuthorAddress =>
    // This doesn't check if it's valid; to do that, parse it and see if parsing has an error.
    `@${shortname}.${encodedPubkey}`;

//================================================================================


export let sha256 = (input : string | Buffer) : EncodedHash =>
    LowLevelCrypto.sha256(input);

export let generateAuthorKeypair = (shortname : string) : AuthorKeypair => {
    // This throws a ValidationError if the shortname doesn't follow the rules.

    let bufferPair : KeypairBuffers = LowLevelCrypto.generateKeypairBuffers();
    let keypair = {
        address: assembleAuthorAddress(shortname, encodePubkey(bufferPair.pubkey)),
        secret: encodeSecret(bufferPair.secret),
    };
    // Make sure it's valid (correct length, etc).  Throw error if invalid.
    ValidatorNew_Es4._assertAuthorIsValid(keypair.address);
    return keypair;
}

export let sign = (keypair : AuthorKeypair, msg : string | Buffer) : EncodedSig => {
    let keypairBuffers = decodeAuthorKeypair(keypair);
    return LowLevelCrypto.sign(keypairBuffers, msg);
}

export let verify = (authorAddress : AuthorAddress, sig : EncodedSig, msg : string | Buffer) : boolean => {
    // If authorAddress is bad, this just returns false instead of throwing a ValidationError.
    try {
        let authorParsed = ValidatorNew_Es4.parseAuthorAddress(authorAddress);
        return LowLevelCrypto.verify(decodePubkey(authorParsed.pubkey), sig, msg);
    } catch (err) {
        if (err instanceof ValidationError) { return false; }
        throw err;
    }
}
