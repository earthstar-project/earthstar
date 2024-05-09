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
import { isErr, ValidationError } from "../util/errors.ts";

export const MIN_SHARE_SHORTNAME_LENGTH = 1;
export const MAX_SHARE_SHORTNAME_LENGTH = 15;

export type ShareKeypair = Cinn25519Keypair;
export type SharePublicKey = ShareKeypair["publicKey"];
export type ShareTag = string;

export async function generateShareKeypair(
  shortname: string,
  owned?: boolean,
): Promise<ShareKeypair | ValidationError> {
  let keypair = await generateCinn25519Keypair(shortname, {
    minLength: MIN_SHARE_SHORTNAME_LENGTH,
    maxLength: MAX_SHARE_SHORTNAME_LENGTH,
  });

  if (isErr(keypair)) {
    return keypair;
  }

  while (
    owned === true && isCommunalShare(keypair.publicKey) ||
    !owned && !isCommunalShare(keypair.publicKey)
  ) {
    keypair = await generateCinn25519Keypair(shortname, {
      minLength: MIN_SHARE_SHORTNAME_LENGTH,
      maxLength: MAX_SHARE_SHORTNAME_LENGTH,
    }) as ShareKeypair;
  }

  return keypair;
}

export async function generateOwnedShareKeypair(
  shortname: string,
): Promise<ShareKeypair | ValidationError> {
  let keypair = await generateShareKeypair(shortname);

  if (isErr(keypair)) {
    return keypair;
  }

  while (isCommunalShare(keypair.publicKey)) {
    keypair = await generateShareKeypair(shortname) as ShareKeypair;
  }

  return keypair;
}

export function shareSign(
  keypair: ShareKeypair,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  return cinn25519Sign(keypair, bytes, MAX_SHARE_SHORTNAME_LENGTH);
}

export function shareVerify(
  keypair: ShareKeypair["publicKey"],
  signature: Uint8Array,
  bytes: Uint8Array,
): Promise<boolean> {
  return cinn25519Verify(
    keypair,
    signature,
    bytes,
    MAX_SHARE_SHORTNAME_LENGTH,
  );
}

export function encodeSharePublicKey(
  publicKey: ShareKeypair["publicKey"],
): Uint8Array {
  return encodeCinn25519PublicKey(publicKey, MAX_SHARE_SHORTNAME_LENGTH);
}

export function decodeSharePublicKey(
  encoded: Uint8Array,
): ShareKeypair["publicKey"] {
  return decodeCinn25519PublickKey(encoded, MAX_SHARE_SHORTNAME_LENGTH);
}

export function decodeStreamSharePublicKey(
  bytes: GrowingBytes,
): Promise<ShareKeypair["publicKey"]> {
  return decodeStreamCinn25519PublickKey(bytes, MAX_SHARE_SHORTNAME_LENGTH);
}

export function encodeShareTag(
  publicKey: ShareKeypair["publicKey"],
): ShareTag {
  const isCommunal =
    (publicKey.underlying[publicKey.underlying.byteLength - 1] & 0x1) === 0x0;

  return encodeCinn25519PublicKeyDisplay(publicKey, isCommunal ? "+" : "-");
}

export function decodeShareTag(
  tag: ShareTag,
): ShareKeypair["publicKey"] | ValidationError {
  const claimsToBeCommunal = tag[0] === "+";

  const publicKey = decodeCinn25519PublickKeyDisplay(
    tag,
    {
      sigil: claimsToBeCommunal ? "+" : "-",
      shortnameMinLength: MIN_SHARE_SHORTNAME_LENGTH,
      shortnameMaxLength: MAX_SHARE_SHORTNAME_LENGTH,
    },
  );

  if (isErr(publicKey)) {
    return publicKey;
  }

  const isActuallyCommunal =
    (publicKey.underlying[publicKey.underlying.byteLength - 1] & 0x1) === 0x0;

  if (claimsToBeCommunal && !isActuallyCommunal) {
    return new ValidationError(
      "Display ID has + sigil, but is for an owned namespace",
    );
  } else if (!claimsToBeCommunal && isActuallyCommunal) {
    return new ValidationError(
      "Display ID has - sigil, but is for a communal namespace",
    );
  }

  return publicKey;
}

export function isValidShareShortname(shortname: string) {
  return isValidShortname(shortname, {
    minLength: MIN_SHARE_SHORTNAME_LENGTH,
    maxLength: MAX_SHARE_SHORTNAME_LENGTH,
  });
}

export function isCommunalShare(publicKey: SharePublicKey): boolean {
  return (publicKey.underlying[31] & 0x1) === 0x0;
}
