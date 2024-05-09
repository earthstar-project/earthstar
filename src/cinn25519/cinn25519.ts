import { concat, GrowingBytes } from "../../deps.ts";
import { decodeBase32, encodeBase32 } from "../encoding/base32.ts";
import { isErr, ValidationError } from "../util/errors.ts";
import { Ed25519 } from "./ed25519/ed25519.ts";

export type Cinn25519Keypair = {
  publicKey: {
    shortname: string;
    underlying: Uint8Array;
  };
  secretKey: Uint8Array;
};

export async function generateCinn25519Keypair(
  shortname: string,
  opts: { minLength: number; maxLength: number },
): Promise<Cinn25519Keypair | ValidationError> {
  const isValid = isValidShortname(shortname, {
    minLength: opts.minLength,
    maxLength: opts.maxLength,
  });

  if (isErr(isValid)) {
    return isValid;
  }

  const { publicKey, secretKey } = await new Ed25519().generateKeypair();

  return {
    publicKey: {
      shortname,
      underlying: publicKey,
    },
    secretKey,
  };
}

export function cinn25519Sign(
  keypair: Cinn25519Keypair,
  bytes: Uint8Array,
  shortnameMaxLength: number,
): Promise<Uint8Array> {
  const messageToSign = concat(
    encodeShortName(keypair.publicKey.shortname, shortnameMaxLength),
    bytes,
  );

  return new Ed25519().sign(messageToSign, keypair.secretKey);
}

export function cinn25519Verify(
  publicKey: Cinn25519Keypair["publicKey"],
  signature: Uint8Array,
  bytes: Uint8Array,
  shortnameMaxLength: number,
): Promise<boolean> {
  const messageToVerify = concat(
    encodeShortName(publicKey.shortname, shortnameMaxLength),
    bytes,
  );

  return new Ed25519().verify(
    publicKey.underlying,
    signature,
    messageToVerify,
  );
}

export function encodeCinn25519PublicKey(
  publicKey: Cinn25519Keypair["publicKey"],
  shortnameMaxLength: number,
): Uint8Array {
  const shortnameEncoded = encodeShortName(
    publicKey.shortname,
    shortnameMaxLength,
  );

  return concat(shortnameEncoded, publicKey.underlying);
}

export function decodeCinn25519PublickKey(
  encoded: Uint8Array,
  shortnameMaxLength: number,
): Cinn25519Keypair["publicKey"] {
  const first0x0Index = encoded.findIndex((byte) => byte === 0x0);

  if (first0x0Index >= shortnameMaxLength || first0x0Index === -1) {
    // Short name is max length.
    const encodedShortname = encoded.subarray(0, shortnameMaxLength);
    const shortname = new TextDecoder().decode(encodedShortname);
    const publicKey = encoded.slice(
      shortnameMaxLength,
      shortnameMaxLength + 32,
    );

    return { shortname, underlying: publicKey };
  }

  const encodedShortname = encoded.subarray(0, first0x0Index);
  const shortname = new TextDecoder().decode(encodedShortname);
  const publicKey = encoded.slice(first0x0Index + 1, first0x0Index + 1 + 32);

  return { shortname, underlying: publicKey };
}

export async function decodeStreamCinn25519PublickKey(
  bytes: GrowingBytes,
  shortnameMaxLength: number,
): Promise<Cinn25519Keypair["publicKey"]> {
  await bytes.nextAbsolute(shortnameMaxLength);

  const terminatorIndex = bytes.array.indexOf(0x0);

  if (terminatorIndex >= shortnameMaxLength || terminatorIndex === -1) {
    await bytes.nextAbsolute(32);

    bytes.prune(shortnameMaxLength + 32);

    return {
      shortname: new TextDecoder().decode(
        bytes.array.slice(0, shortnameMaxLength),
      ),
      underlying: bytes.array.slice(
        shortnameMaxLength,
        shortnameMaxLength + 32,
      ),
    };
  }

  const alreadyHavePubkeyBytes =
    bytes.array.subarray(terminatorIndex).byteLength - 1;
  await bytes.nextAbsolute(32 - alreadyHavePubkeyBytes);

  return {
    shortname: new TextDecoder().decode(
      bytes.array.slice(0, terminatorIndex),
    ),
    underlying: bytes.array.slice(
      terminatorIndex + 1,
      terminatorIndex + 1 + 32,
    ),
  };
}

export function encodeShortName(
  shortname: string,
  maxLength: number,
): Uint8Array {
  const ascii = new TextEncoder().encode(shortname);

  if (shortname.length === maxLength) {
    return ascii;
  }

  return concat(ascii, new Uint8Array([0x0]));
}

export function encodeCinn25519PublicKeyDisplay(
  publicKey: Cinn25519Keypair["publicKey"],
  sigil: string,
): string {
  const base32 = encodeBase32(publicKey.underlying);

  return `${sigil}${publicKey.shortname}.${base32}`;
}

export function decodeCinn25519PublickKeyDisplay(
  display: string,
  opts: {
    sigil: string;
    shortnameMinLength: number;
    shortnameMaxLength: number;
  },
): Cinn25519Keypair["publicKey"] | ValidationError {
  if (display[0] !== opts.sigil) {
    return new ValidationError(
      `Display ID started with ${display[0]} sigil, wanted ${opts.sigil}`,
    );
  }

  const splitIndex = display.indexOf(".");

  if (splitIndex === -1) {
    return new ValidationError("Display ID doesn't have a . separator");
  }

  const parts = display.slice(1).split(".");

  if (parts.length !== 2) {
    return new ValidationError(
      `Display ID must have exactly 2 parts separated by a . separator`,
    );
  }

  const [shortname, b32Pubkey] = parts;

  const shortnameIsValid = isValidShortname(shortname, {
    minLength: opts.shortnameMinLength,
    maxLength: opts.shortnameMaxLength,
  });

  if (isErr(shortnameIsValid)) {
    return shortnameIsValid;
  }

  if (b32Pubkey[0] !== "b") {
    return new ValidationError("Display ID pubkey must start with a b");
  }

  if (b32Pubkey.length !== 53) {
    return new ValidationError("Display ID pubkey must be 53 characters long");
  }

  const decoded = decodeBase32(b32Pubkey);

  return {
    shortname,
    underlying: decoded,
  };
}

export function isValidShortname(shortname: string, opts: {
  minLength: number;
  maxLength: number;
}): true | ValidationError {
  if (shortname.length < opts.minLength) {
    return new ValidationError(
      `Shortname "${shortname}" too short, minimum length is ${opts.minLength}`,
    );
  }

  if (shortname.length > opts.maxLength) {
    return new ValidationError(
      `Shortname "${shortname}" too long, maximum length is ${opts.maxLength}`,
    );
  }

  for (let i = 0; i < shortname.length; i++) {
    const asciiCode = shortname.charCodeAt(i);

    if (!asciiCode) {
      return new ValidationError("");
    }

    const isAlpha = asciiCode >= 0x61 && asciiCode <= 0x7a;
    const isNumeric = asciiCode >= 0x30 && asciiCode <= 0x39;

    if (i === 0 && isNumeric) {
      return new ValidationError("Shortnames must not start with a number");
    }

    if (!isAlpha && !isNumeric) {
      return new ValidationError(
        "Shortnames must only contain numbers (0-9) or lowercase letters (a-z)",
      );
    }
  }

  return true;
}
