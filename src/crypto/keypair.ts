import { AuthorKeypair, AuthorShortname } from "../util/doc-types.ts";
import { isErr, ValidationError } from "../util/errors.ts";
import { base32BytesToString, base32StringToBytes } from "./base32.ts";
import { KeypairBytes } from "./crypto-types.ts";
import { assembleAuthorAddress, parseAuthorAddress } from "../core-validators/addresses.ts";

//================================================================================

/** Combine a shortname with a raw KeypairBytes to make an AuthorKeypair */
export let encodeAuthorKeypairToStrings = (
    shortname: AuthorShortname,
    pair: KeypairBytes,
): AuthorKeypair => ({
    address: assembleAuthorAddress(shortname, base32BytesToString(pair.pubkey)),
    secret: base32BytesToString(pair.secret),
});

/** Convert an AuthorKeypair back into a raw KeypairBytes for use in crypto operations. */
export let decodeAuthorKeypairToBytes = (
    pair: AuthorKeypair,
): KeypairBytes | ValidationError => {
    try {
        let authorParsed = parseAuthorAddress(pair.address);
        if (isErr(authorParsed)) return authorParsed;
        let bytes = {
            pubkey: base32StringToBytes(authorParsed.pubkey),
            secret: base32StringToBytes(pair.secret),
        };
        /* istanbul ignore next */
        if (bytes.pubkey.length !== 32) {
            // this is already checked by parseAuthorAddress so we can't test it here
            // but we'll test it again just to make sure.
            return new ValidationError(
                `pubkey bytes should be 32 bytes long, not ${bytes.pubkey.length} after base32 decoding.  ${pair.address}`,
            );
        }
        if (bytes.secret.length !== 32) {
            return new ValidationError(
                `secret bytes should be 32 bytes long, not ${bytes.secret.length} after base32 decoding.  ${pair.secret}`,
            );
        }
        return bytes;
    } catch (err: any) {
        return new ValidationError(
            "crash while decoding author keypair: " + err.message,
        );
    }
};
