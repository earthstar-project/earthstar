import mb = require('multibase');
import {
    AuthorKeypair,
    AuthorShortname,
} from '../util/types';
import {
    KeypairBuffers,
} from './cryptoTypes';
import {
    parseAuthorAddress,
    makeAuthorAddress,
} from '../util/addresses';

let encodeBuffer = (b : Buffer) : string =>
    mb.encode('base58btc', b).toString().slice(1);  // take off the 'z' prefix that means base58btc
let decodeBuffer = (s : string) : Buffer =>
    mb.decode('z' + s);

export let encodePubkey = encodeBuffer;
export let encodeSecret = encodeBuffer;
export let encodeSig = encodeBuffer;

export let decodePubkey = decodeBuffer;
export let decodeSecret = decodeBuffer;
export let decodeSig = decodeBuffer;

export let encodeAuthorKeypair = (shortname : AuthorShortname, pair : KeypairBuffers) : AuthorKeypair => ({
    address: makeAuthorAddress(shortname, encodePubkey(pair.pubkey)),
    secret: encodeSecret(pair.secret),
});

export let decodeAuthorKeypair = (pair : AuthorKeypair) : KeypairBuffers => {
    let {authorParsed, err} = parseAuthorAddress(pair.address);
    if (err || authorParsed === null) { throw 'could not parse author address: ' + pair.address + '  -- err: ' + err; }
    return {
        pubkey: decodePubkey(authorParsed.pubkey),
        secret: decodeSecret(pair.secret),
    }
};
