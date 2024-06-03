import type { GrowingBytes } from "@earthstar/willow-utils";
import {
  type Cinn25519Keypair,
  cinn25519Sign,
  cinn25519Verify,
  decodeCinn25519PublickKey,
  decodeCinn25519PublickKeyDisplay,
  decodeStreamCinn25519PublickKey,
  encodeCinn25519PublicKey,
  encodeCinn25519PublicKeyDisplay,
  generateCinn25519Keypair,
  isValidShortname,
} from "../cinn25519/cinn25519.ts";
import type { ValidationError } from "../util/errors.ts";
import type { Ed25519Driver } from "../cinn25519/types.ts";
import { Base32String } from "../encoding/types.ts";

export const MIN_IDENTITY_SHORTNAME_LENGTH = 4;
export const MAX_IDENTITY_SHORTNAME_LENGTH = 4;

export type IdentityKeypairRaw = Cinn25519Keypair;
export type IdentityPublicKey = IdentityKeypairRaw["publicKey"];
/** An identity's public key encoded in a more human-friendly form. */
export type IdentityTag = string;
/** An identity's tag and its corresponding secret key. */
export type IdentityKeypair = {
  tag: IdentityTag;
  secretKey: Base32String;
};

export function generateIdentityKeypair(
  shortname: string,
  driver: Ed25519Driver<Uint8Array>,
): Promise<IdentityKeypairRaw | ValidationError> {
  return generateCinn25519Keypair(shortname, {
    minLength: MIN_IDENTITY_SHORTNAME_LENGTH,
    maxLength: MAX_IDENTITY_SHORTNAME_LENGTH,
    driver: driver,
  });
}

export function identitySign(
  keypair: IdentityKeypairRaw,
  bytes: Uint8Array,
  driver: Ed25519Driver<Uint8Array>,
): Promise<Uint8Array> {
  return cinn25519Sign(keypair, bytes, MAX_IDENTITY_SHORTNAME_LENGTH, driver);
}

export function identityVerify(
  publicKey: IdentityKeypairRaw["publicKey"],
  signature: Uint8Array,
  bytes: Uint8Array,
  driver: Ed25519Driver<Uint8Array>,
): Promise<boolean> {
  return cinn25519Verify(
    publicKey,
    signature,
    bytes,
    MAX_IDENTITY_SHORTNAME_LENGTH,
    driver,
  );
}

export function encodeIdentityPublicKey(
  publicKey: IdentityKeypairRaw["publicKey"],
): Uint8Array {
  return encodeCinn25519PublicKey(publicKey, MAX_IDENTITY_SHORTNAME_LENGTH);
}

export function decodeIdentityPublicKey(
  encoded: Uint8Array,
): IdentityKeypairRaw["publicKey"] {
  return decodeCinn25519PublickKey(encoded, MAX_IDENTITY_SHORTNAME_LENGTH);
}

export function decodeStreamIdentityPublicKey(
  bytes: GrowingBytes,
): Promise<IdentityKeypairRaw["publicKey"]> {
  return decodeStreamCinn25519PublickKey(bytes, MAX_IDENTITY_SHORTNAME_LENGTH);
}

export function encodeIdentityTag(
  publicKey: IdentityKeypairRaw["publicKey"],
): IdentityTag {
  return encodeCinn25519PublicKeyDisplay(publicKey, "@");
}

export function decodeIdentityTag(
  tag: IdentityTag,
): IdentityKeypairRaw["publicKey"] | ValidationError {
  return decodeCinn25519PublickKeyDisplay(
    tag,
    {
      sigil: "@",
      shortnameMinLength: MIN_IDENTITY_SHORTNAME_LENGTH,
      shortnameMaxLength: MAX_IDENTITY_SHORTNAME_LENGTH,
    },
  );
}

export function isValidIdentityShortname(shortname: string) {
  return isValidShortname(shortname, {
    minLength: MIN_IDENTITY_SHORTNAME_LENGTH,
    maxLength: MAX_IDENTITY_SHORTNAME_LENGTH,
  });
}
