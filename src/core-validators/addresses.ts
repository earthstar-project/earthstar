import {
  AuthorAddress,
  AuthorShortname,
  Base32String,
  ParsedAddress,
  ShareAddress,
  ShareName,
} from "../util/doc-types.ts";
import { notErr, ValidationError } from "../util/errors.ts";

import {
  authorKeyChars,
  authorNameChars,
  isDigit,
  onlyHasChars,
  workspaceKeyChars,
  workspaceNameChars,
} from "./characters.ts";

//================================================================================

/** Put a short name and pub key together into an identity address. */
export function assembleAuthorAddress(
  name: AuthorShortname,
  encodedPubkey: Base32String,
): AuthorAddress // This doesn't check if it's valid; to do that, parse it and see if parsing has an error.
{
  return `@${name}.${encodedPubkey}`;
}

/** Put a share name and encoded pub key together into a share address. */
export function assembleShareAddress(
  name: ShareName,
  encodedPubkey: Base32String,
): ShareAddress // This doesn't check if it's valid; to do that, parse it and see if parsing has an error.
{
  return `+${name}.${encodedPubkey}`;
}

/** Check that an identity address is valid. */
export function checkAuthorIsValid(
  addr: AuthorAddress,
): true | ValidationError {
  const parsed = parseAuthorAddress(addr);
  if (notErr(parsed)) return true;
  return parsed;
}

/** Check that a share address is valid. */
export function checkShareIsValid(
  addr: ShareAddress,
): true | ValidationError {
  const parsed = parseShareAddress(addr);
  if (notErr(parsed)) return true;
  return parsed;
}

/** Parse a share or author address into its parts */
export function parseAuthorOrShareAddress(
  address: AuthorAddress | ShareAddress,
): ParsedAddress | ValidationError {
  if (address.startsWith("@")) {
    return parseAuthorAddress(address);
  } else if (address.startsWith("+")) {
    return parseShareAddress(address);
  }

  return new ValidationError("address must start with either @ or +");
}

/** Parse an author address into its parts. */
export function parseAuthorAddress(
  address: AuthorAddress,
): ParsedAddress | ValidationError {
  return parseAddress(address, {
    sigil: "@",
    separator: ".",
    minNameLength: 4,
    maxNameLength: 4,
    minPubkeyLength: 53,
    maxPubkeyLength: 53,
    allowedNameCharacters: authorNameChars,
    allowedPubkeyCharacters: authorKeyChars,
    pubkeyMustStartWithB: true,
  });
}

/** Parse a share address into its parts. */
export function parseShareAddress(
  address: ShareAddress,
): ParsedAddress | ValidationError {
  return parseAddress(address, {
    sigil: "+",
    separator: ".",
    minNameLength: 1,
    maxNameLength: 15,
    minPubkeyLength: 53,
    maxPubkeyLength: 53,
    allowedNameCharacters: workspaceNameChars,
    allowedPubkeyCharacters: workspaceKeyChars,
    pubkeyMustStartWithB: true,
  });
}

interface ParseAddressOpts {
  sigil: string; // '+' or '@'
  separator: string; // '.'
  minNameLength: number;
  maxNameLength: number;
  minPubkeyLength: number;
  maxPubkeyLength: number;
  allowedNameCharacters: string;
  allowedPubkeyCharacters: string;
  pubkeyMustStartWithB: boolean;
}
export function parseAddress(
  address: string,
  opts: ParseAddressOpts,
): ParsedAddress | ValidationError {
  const {
    sigil,
    separator,
    minNameLength,
    maxNameLength,
    minPubkeyLength,
    maxPubkeyLength,
    allowedNameCharacters,
    allowedPubkeyCharacters,
    pubkeyMustStartWithB,
  } = opts;
  if (typeof address !== "string") {
    return new ValidationError("address must be a string");
  }
  if (address.length < 4) return new ValidationError("address is too short");
  if (address[0] !== sigil) {
    return new ValidationError(
      `address must start with a sigil: "${sigil}"`,
    );
  }
  if (address.indexOf(separator) === -1) {
    return new ValidationError(
      `address must contain a separator character: "${separator}"`,
    );
  }
  const parts = address.slice(1).split(separator);
  if (parts.length !== 2) {
    return new ValidationError(
      `address must have exactly 2 parts separated by a "${separator}" separator`,
    );
  }
  const [name, pubkey] = parts;
  if (name.length < minNameLength || name.length > maxNameLength) {
    return new ValidationError(
      `name must be between ${minNameLength} and ${maxNameLength} characters long, but is ${name.length}`,
    );
  }
  if (pubkey.length < minPubkeyLength || pubkey.length > maxPubkeyLength) {
    return new ValidationError(
      `pubkey must be between ${minPubkeyLength} and ${maxPubkeyLength} characters long, but is ${pubkey.length}`,
    );
  }
  if (!onlyHasChars(name, allowedNameCharacters)) {
    return new ValidationError(
      `name "${name}" must only have allowed characters`,
    );
  }
  if (!onlyHasChars(pubkey, allowedPubkeyCharacters)) {
    return new ValidationError(
      `pubkey "${pubkey}" must only have allowed characters`,
    );
  }
  if (isDigit(name[0])) {
    return new ValidationError(
      `name "${name}" must not start with a digit`,
    );
  }
  if (isDigit(pubkey[0])) {
    return new ValidationError(
      `pubkey "${pubkey}" must not start with a digit`,
    );
  }
  if (pubkeyMustStartWithB && pubkey[0] !== "b") {
    return new ValidationError(`pubkey "${pubkey}" must start with 'b'`);
  }

  return {
    address,
    name,
    pubkey,
  };
}
