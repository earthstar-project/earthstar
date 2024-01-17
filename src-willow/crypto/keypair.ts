import {
  parseIdentityAddress,
  parseShareAddress,
} from "../core_validators/addresses.ts";
import { decodeBase32 } from "../encoding/base32.ts";
import { isErr, ValidationError } from "../util/errors.ts";
import {
  IdentityKeypair,
  OwnedNamespaceKeypair,
  ParsedAddress,
} from "./types.ts";

/** Convert an address back into a raw Uint8Array for use in crypto operations. */
export function decodeKeypairAddressToBytes<PrivateKey>(
  keypair: IdentityKeypair<PrivateKey> | OwnedNamespaceKeypair<PrivateKey>,
): Uint8Array | ValidationError {
  let parsed: ParsedAddress | ValidationError;

  if (isIdentityKeypair(keypair)) {
    parsed = parseIdentityAddress(keypair.identityAddress);
  } else {
    parsed = parseShareAddress(keypair.shareAddress);
  }

  if (isErr(parsed)) return parsed;

  const bytes = decodeBase32(parsed.pubkey);

  if (bytes.byteLength !== 32) {
    // this is already checked by parseAuthorAddress so we can't test it here
    // but we'll test it again just to make sure.
    return new ValidationError(
      `pubkey bytes should be 32 bytes long, not ${parsed.pubkey.length} after base32 decoding.  ${parsed.pubkey}`,
    );
  }

  return bytes;
}

export function isIdentityKeypair<PrivateKey>(
  keypair: IdentityKeypair<PrivateKey> | OwnedNamespaceKeypair<PrivateKey>,
): keypair is IdentityKeypair<PrivateKey> {
  return "identityAddress" in keypair;
}
