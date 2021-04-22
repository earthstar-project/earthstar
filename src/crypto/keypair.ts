import {
    AuthorKeypair,
    AuthorShortname,
} from '../types/doc-types';
import {
    ValidationError,
    isErr,
} from '../util/errors';
import {
    base32StringToBytes,
    base32BytesToString
} from './base32';
import {
    KeypairBytes,
} from './crypto-types';
import {
    assembleAuthorAddress,
    parseAuthorAddress
} from '../core-validators/addresses';

//================================================================================

/** Combine a shortname with a raw KeypairBytes to make an AuthorKeypair */
export let encodeAuthorKeypairToStrings = (shortname: AuthorShortname, pair: KeypairBytes): AuthorKeypair => ({
    address: assembleAuthorAddress(shortname, base32BytesToString(pair.pubkey)),
    secret: base32BytesToString(pair.secret),
});

/** Convert an AuthorKeypair back into a raw KeypairBytes for use in crypto operations. */
export let decodeAuthorKeypairToBytes = (pair: AuthorKeypair): KeypairBytes | ValidationError => {
    try {
        let authorParsed = parseAuthorAddress(pair.address);
        if (isErr(authorParsed)) { return authorParsed; }
        let bytes = {
            pubkey: base32StringToBytes(authorParsed.pubkey),
            secret: base32StringToBytes(pair.secret),
        };
        if (bytes.pubkey.length !== 32) {
            return new ValidationError(`pubkey bytes should be 32 bytes long, not ${bytes.pubkey.length} after base32 decoding.  ${pair.address}`);
        }
        if (bytes.secret.length !== 32) {
            return new ValidationError(`secret bytes should be 32 bytes long, not ${bytes.secret.length} after base32 decoding.  ${pair.secret}`);
        }
        return bytes;
    } catch (err) {
        return new ValidationError('crash while decoding author keypair: ' + err.message);
    }
};
