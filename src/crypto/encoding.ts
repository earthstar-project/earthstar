import mb = require('multibase');
import {
    AuthorKeypair,
    AuthorShortname,
    Base32String,
    WorkspaceName,
    EncodedKey,
    WorkspaceAddress,
    AuthorAddress,
} from '../util/types';
import {
    KeypairBuffers,
} from './cryptoTypes';
import {
    ValidatorNew_Es4,
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

// For base32 encoding we use rfc4648, no padding, lowercase, prefixed with "b".
// The Multibase format adds a "b" prefix to specify this particular encoding.
// We leave the "b" prefix there because we don't want the encoded string
// to start with a number (so we can use it as a URL location).
// Character set: "abcdefghijklmnopqrstuvwxyz234567"
// The decoding must be strict (it doesn't allow a 1 in place of an i, etc).
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
    // This throws a ValidationError if the address is bad
    let authorParsed = ValidatorNew_Es4.parseAuthorAddress(pair.address);
    return {
        pubkey: decodePubkey(authorParsed.pubkey),
        secret: decodeSecret(pair.secret),
    }
};
