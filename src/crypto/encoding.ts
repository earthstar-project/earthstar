import {
    codec
} from 'rfc4648';
import {
    AuthorAddress,
    AuthorKeypair,
    AuthorShortname,
    Base32String,
    EncodedKey,
    ValidationError,
    WorkspaceAddress,
    WorkspaceName,
    isErr,
} from '../util/types';
import {
    KeypairBuffers,
} from './cryptoTypes';
import {
    ValidatorEs4,
} from '../validator/es4';

//================================================================================
// TODO: this really should happen in the validator?

let assembleWorkspaceAddress = (name: WorkspaceName, encodedPubkey: EncodedKey): WorkspaceAddress =>
    // This doesn't check if it's valid; to do that, parse it and see if parsing has an error.
    `+${name}.${encodedPubkey}`;

let assembleAuthorAddress = (shortname: AuthorShortname, encodedPubkey: EncodedKey): AuthorAddress =>
    // This doesn't check if it's valid; to do that, parse it and see if parsing has an error.
    `@${shortname}.${encodedPubkey}`;

//================================================================================

/**
 * For base32 encoding we use rfc4648, no padding, lowercase, prefixed with "b".
 * 
 * Base32 character set: `abcdefghijklmnopqrstuvwxyz234567`
 * 
 * The Multibase format adds a "b" prefix to specify this particular encoding.
 * We leave the "b" prefix there because we don't want the encoded string
 * to start with a number (so we can use it as a URL location).
 * 
 * When decoding, we require it to start with a "b" --
 * no other multibase formats are allowed.
 * 
 * The decoding must be strict (it doesn't allow a 1 in place of an i, etc).
 */
const myEncoding = {
    chars: "abcdefghijklmnopqrstuvwxyz234567",
    bits: 5,
};

/**
 * Encode buffer to base32 string
 */
export let encodeBufferToBase32 = (buf: Buffer): Base32String =>
    'b' + codec.stringify(buf, myEncoding, { pad: false });

/**
 * Decode base32 data to a Buffer.  Throw a ValidationError if the string is bad.
 */
export let decodeBase32ToBuffer = (str: Base32String): Buffer => {
    if (!str.startsWith('b')) { throw new ValidationError("can't decode base32 string - it should start with a 'b'. " + str); }
    // this library combines padding and looseness settings into a single "loose" option, so
    // we have to set "loose: true" in order to handle unpadded inputs.
    // with a custom codec, loose mode:
    // -- allows padding or no padding
    // -- does not allow uppercase
    // -- does not allow 1/i substitution

    // make sure no padding characters are on the end
    if (str[str.length-1] === '=') {
        throw new ValidationError("can't decode base32 string - it contains padding characters ('=')");
    }
    return codec.parse(str.slice(1), myEncoding, { loose: true, out: Buffer.alloc as any }) as any as Buffer;
};

export let encodePubkey = encodeBufferToBase32;
export let encodeSecret = encodeBufferToBase32;
export let encodeSig = encodeBufferToBase32;
export let encodeHash = encodeBufferToBase32;

export let decodePubkey = decodeBase32ToBuffer;
export let decodeSecret = decodeBase32ToBuffer;
export let decodeSig = decodeBase32ToBuffer;

/** Combine a shortname with a raw KeypairBuffers to make an AuthorKeypair */
export let encodeAuthorKeypair = (shortname: AuthorShortname, pair: KeypairBuffers): AuthorKeypair => ({
    address: assembleAuthorAddress(shortname, encodePubkey(pair.pubkey)),
    secret: encodeSecret(pair.secret),
});

/** Convert an AuthorKeypair back into a raw KeypairBuffers for use in crypto operations. */
export let decodeAuthorKeypair = (pair: AuthorKeypair): KeypairBuffers | ValidationError => {
    try {
        let authorParsed = ValidatorEs4.parseAuthorAddress(pair.address);
        if (isErr(authorParsed)) { return authorParsed; }
        let buffers = {
            pubkey: decodePubkey(authorParsed.pubkey),
            secret: decodeSecret(pair.secret),
        };
        if (buffers.pubkey.length !== 32) {
            return new ValidationError(`pubkey buffer should be 32 bytes long, not ${buffers.pubkey.length} after base32 decoding.  ${pair.address}`);
        }
        if (buffers.secret.length !== 32) {
            return new ValidationError(`secret buffer should be 32 bytes long, not ${buffers.secret.length} after base32 decoding.  ${pair.secret}`);
        }
        return buffers;
    } catch (err) {
        return new ValidationError('crash while decoding author keypair: ' + err.message);
    }
};
