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
    makeAuthorAddress,
    parseAuthorAddress,
} from '../util/addresses';

export let sha256 = (input : string | Buffer) : string =>
    LowLevelCrypto.sha256(input);

export let generateAuthorKeypair = (shortname : string) : AuthorKeypair => {
    let bufferPair : KeypairBuffers;
    let pubkey : string;
    // generate over and over until it doesn't start with a number
    // and it's 44 chars long
    let ii = 1000;
    while (true) {
        ii -= 1;
        if (ii === 0) { throw "generateAuthorKeypair was stuck in infinite loop"; }
        bufferPair = LowLevelCrypto.generateKeypairBuffers();
        pubkey = encodePubkey(bufferPair.pubkey);
        // if it starts with a number, or length is not 44, try again
        if ('0123456789'.indexOf(pubkey[0]) !== -1) { continue; }
        if (pubkey.length !== 44) { continue; }
        // we did it
        break;
    }
    return {
        address: makeAuthorAddress(shortname, encodePubkey(bufferPair.pubkey)),
        secret: encodeSecret(bufferPair.secret),
    };
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
