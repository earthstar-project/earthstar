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
    let bufferPair : KeypairBuffers;
    let pubkey : string;
    // When a buffer starts with zeros, base58 encoding can make
    // a shorter than usual result.
    // We want our encoded pubkeys to always be the same length (44 chars).
    // We also want them to not start with a number.
    // So, generate over and over until we get one we like.
    let ii = 1000;
    while (true) {
        ii -= 1;
        if (ii === 0) { throw new Error("generateAuthorKeypair was stuck in infinite loop"); }
        bufferPair = LowLevelCrypto.generateKeypairBuffers();
        pubkey = encodePubkey(bufferPair.pubkey);
        // if it starts with a number, or length is not 44, try again
        if ('0123456789'.indexOf(pubkey[0]) !== -1) { continue; }
        if (pubkey.length !== 44) { continue; }
        // we did it
        break;
    }
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
