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

export type IdentityKeypair = Cinn25519Keypair;
export type IdentityPublicKey = IdentityKeypair["publicKey"];
export type IdentityDisplayKey = string;

export function generateIdentityKeypair(
  shortname: string,
): Promise<IdentityKeypair | ValidationError> {
  return generateCinn25519Keypair(shortname, {
    minLength: MIN_IDENTITY_SHORTNAME_LENGTH,
    maxLength: MAX_IDENTITY_SHORTNAME_LENGTH,
  });
}

export function identitySign(
  keypair: IdentityKeypair,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  return cinn25519Sign(keypair, bytes, MAX_IDENTITY_SHORTNAME_LENGTH);
}

export function identityVerify(
  publicKey: IdentityKeypair["publicKey"],
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
  publicKey: IdentityKeypair["publicKey"],
): Uint8Array {
  return encodeCinn25519PublicKey(publicKey, MAX_IDENTITY_SHORTNAME_LENGTH);
}

export function decodeIdentityPublicKey(
  encoded: Uint8Array,
): IdentityKeypair["publicKey"] {
  return decodeCinn25519PublickKey(encoded, MAX_IDENTITY_SHORTNAME_LENGTH);
}

export function decodeStreamIdentityPublicKey(
  bytes: GrowingBytes,
): Promise<IdentityKeypair["publicKey"]> {
  return decodeStreamCinn25519PublickKey(bytes, MAX_IDENTITY_SHORTNAME_LENGTH);
}

export function encodeIdentityPublicKeyDisplay(
  publicKey: IdentityKeypair["publicKey"],
): string {
  return encodeCinn25519PublicKeyDisplay(publicKey, "@");
}

export function decodeIdentityPublicKeyDisplay(
  display: string,
): IdentityKeypair["publicKey"] | ValidationError {
  return decodeCinn25519PublickKeyDisplay(
    display,
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
