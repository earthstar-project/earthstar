import {
    AuthorKeypair,
    AuthorShortname,
} from '../types/doc-types';
import {
    ValidationError,
    isErr,
} from '../util/errors';
import {
    base32StringToBuffer,
    bufferToBase32String
} from '../base32';
import {
    KeypairBuffers,
} from '../types/crypto-types';
import {
    assembleAuthorAddress,
    parseAuthorAddress
} from '../core-validators/addresses';

//================================================================================

/** Combine a shortname with a raw KeypairBuffers to make an AuthorKeypair */
export let encodeAuthorKeypair = (shortname: AuthorShortname, pair: KeypairBuffers): AuthorKeypair => ({
    address: assembleAuthorAddress(shortname, bufferToBase32String(pair.pubkey)),
    secret: bufferToBase32String(pair.secret),
});

/** Convert an AuthorKeypair back into a raw KeypairBuffers for use in crypto operations. */
export let decodeAuthorKeypair = (pair: AuthorKeypair): KeypairBuffers | ValidationError => {
    try {
        let authorParsed = parseAuthorAddress(pair.address);
        if (isErr(authorParsed)) { return authorParsed; }
        let buffers = {
            pubkey: base32StringToBuffer(authorParsed.pubkey),
            secret: base32StringToBuffer(pair.secret),
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
