import { GrowingBytes } from "../../deps.ts";
import {
  Cinn25519Keypair,
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
import { ValidationError } from "../util/errors.ts";

export const MIN_IDENTITY_SHORTNAME_LENGTH = 4;
export const MAX_IDENTITY_SHORTNAME_LENGTH = 4;

export type IdentityKeypairRaw = Cinn25519Keypair;
export type IdentityPublicKey = IdentityKeypairRaw["publicKey"];
export type IdentityTag = string;
export type IdentityKeypair = {
  tag: IdentityTag;
  secretKey: Uint8Array;
};

export function generateIdentityKeypair(
  shortname: string,
): Promise<IdentityKeypairRaw | ValidationError> {
  return generateCinn25519Keypair(shortname, {
    minLength: MIN_IDENTITY_SHORTNAME_LENGTH,
    maxLength: MAX_IDENTITY_SHORTNAME_LENGTH,
  });
}

export function identitySign(
  keypair: IdentityKeypairRaw,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  return cinn25519Sign(keypair, bytes, MAX_IDENTITY_SHORTNAME_LENGTH);
}

export function identityVerify(
  publicKey: IdentityKeypairRaw["publicKey"],
  signature: Uint8Array,
  bytes: Uint8Array,
): Promise<boolean> {
  return cinn25519Verify(
    publicKey,
    signature,
    bytes,
    MAX_IDENTITY_SHORTNAME_LENGTH,
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
