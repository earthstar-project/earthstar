import { AuthorShortname } from "../util/doc-types.ts";
import { isErr, ValidationError } from "../util/errors.ts";
import { base32BytesToString, base32StringToBytes } from "./base32.ts";
import { AuthorKeypair, KeypairBytes, ShareKeypair } from "./crypto-types.ts";
import {
  assembleAuthorAddress,
  assembleShareAddress,
  parseAuthorOrShareAddress,
} from "../core-validators/addresses.ts";

//================================================================================

/** Combine a shortname with a raw KeypairBytes to make an AuthorKeypair */
export function encodeAuthorKeypairToStrings(
  shortname: AuthorShortname,
  pair: KeypairBytes,
): AuthorKeypair {
  return ({
    address: assembleAuthorAddress(shortname, base32BytesToString(pair.pubkey)),
    secret: base32BytesToString(pair.secret),
  });
}

/** Combine a name with a raw KeypairBytes to make an ShareKeypair */
export function encodeShareKeypairToStrings(
  name: string,
  pair: KeypairBytes,
) {
  return ({
    address: assembleShareAddress(name, base32BytesToString(pair.pubkey)),
    secret: base32BytesToString(pair.secret),
  });
}

/** Convert a keypair (author / share) back into a raw KeypairBytes for use in crypto operations. */
export function decodeKeypairToBytes(
  pair: AuthorKeypair | ShareKeypair,
): KeypairBytes | ValidationError {
  try {
    const address = isAuthorKeypair(pair) ? pair.address : pair.shareAddress;

    const parsed = parseAuthorOrShareAddress(address);
    if (isErr(parsed)) return parsed;
    const bytes = {
      pubkey: base32StringToBytes(parsed.pubkey),
      secret: base32StringToBytes(pair.secret),
    };
    if (bytes.pubkey.length !== 32) {
      // this is already checked by parseAuthorAddress so we can't test it here
      // but we'll test it again just to make sure.
      return new ValidationError(
        `pubkey bytes should be 32 bytes long, not ${bytes.pubkey.length} after base32 decoding.  ${address}`,
      );
    }
    if (bytes.secret.length !== 32) {
      return new ValidationError(
        `secret bytes should be 32 bytes long, not ${bytes.secret.length} after base32 decoding.  ${pair.secret}`,
      );
    }
    return bytes;
  } catch (err) {
    return new ValidationError(
      "crash while decoding author keypair: " + err.message,
    );
  }
}

export function isAuthorKeypair(
  keypair: AuthorKeypair | ShareKeypair,
): keypair is AuthorKeypair {
  return "address" in keypair;
}
