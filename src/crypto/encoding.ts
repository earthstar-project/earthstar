import mb = require('multibase');
import {
    AuthorKeypair,
    AuthorShortname,
    HexLower,
    Base32String,
} from '../util/types';
import {
    KeypairBuffers,
} from './cryptoTypes';
import {
    parseAuthorAddress,
    assembleAuthorAddress,
} from '../util/addresses';

// We use rfc4648, no padding, lowercase, prefixed with "b".
// Multibase adds a "b" prefix to specify this particular encoding.
// We leave the "b" prefix there because we don't want the encoded string
// to start with a number (so we can use it as a URL location).
// Character set: "abcdefghijklmnopqrstuvwxyz234567"
// The decoding is strict (it doesn't allow a 1 in place of an i, etc).
let encodeBuffer = (b : Buffer) : Base32String =>
    mb.encode('base32', b).toString();
let decodeBuffer = (s : Base32String) : Buffer =>
    mb.decode(s);

export let encodePubkey = encodeBuffer;
export let encodeSecret = encodeBuffer;
export let encodeSig = encodeBuffer;

export let decodePubkey = decodeBuffer;
export let decodeSecret = decodeBuffer;
export let decodeSig = decodeBuffer;

export let encodeAuthorKeypair = (shortname : AuthorShortname, pair : KeypairBuffers) : AuthorKeypair => ({
    address: assembleAuthorAddress(shortname, encodePubkey(pair.pubkey)),
    secret: encodeSecret(pair.secret),
});

export let decodeAuthorKeypair = (pair : AuthorKeypair) : KeypairBuffers => {
    let {authorParsed, err} = parseAuthorAddress(pair.address);
    if (err || authorParsed === null) { throw new Error('could not parse author address: ' + pair.address + '  -- err: ' + err); }
    return {
        pubkey: decodePubkey(authorParsed.pubkey),
        secret: decodeSecret(pair.secret),
    }
};
