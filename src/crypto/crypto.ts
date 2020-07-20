import { CryptoChloride as LowLevelCrypto } from './cryptoChloride';
//import { CryptoNode as LowLevelCrypto } from './cryptoNode';
export { LowLevelCrypto };

import {
    AuthorAddress,
    AuthorKeypair,
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
    assembleAuthorAddress,
    parseAuthorAddress,
} from '../util/addresses';

export let sha256 = (input : string | Buffer) : string =>
    LowLevelCrypto.sha256(input);

export let generateAuthorKeypair = (shortname : string) : AuthorKeypair => {
    let bufferPair : KeypairBuffers = LowLevelCrypto.generateKeypairBuffers();
    let keypair = {
        address: assembleAuthorAddress(shortname, encodePubkey(bufferPair.pubkey)),
        secret: encodeSecret(bufferPair.secret),
    };
    // Parse it to make sure it's valid
    // This is where we detect if the shortname is bad (wrong length, etc)
    let { authorParsed, err } = parseAuthorAddress(keypair.address);
    if (err) { throw new Error(err); }
    return keypair;
}

export let sign = (keypair : AuthorKeypair, msg : string | Buffer) : string => {
    let keypairBuffers = decodeAuthorKeypair(keypair);
    return LowLevelCrypto.sign(keypairBuffers, msg);
}

export let verify = (authorAddress : AuthorAddress, sig : string, msg : string | Buffer) : boolean => {
    let { authorParsed, err } = parseAuthorAddress(authorAddress);
    if (err || authorParsed === null) { throw 'could not parse author address: ' + authorAddress + '  -- err: ' + err; }
    return LowLevelCrypto.verify(decodePubkey(authorParsed.pubkey), sig, msg);
}
