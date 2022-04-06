import {
  AuthorAddress,
  AuthorKeypair,
  Base32String,
} from "../util/doc-types.ts";
import { ValidationError } from "../util/errors.ts";

export interface KeypairBytes {
  pubkey: Uint8Array;
  secret: Uint8Array;
}

/** Higher-level crypto functions. Not used directly for the most part, but useful for generating new keypairs. */
// These all handle base32-encoded strings.
export interface ICrypto {
  sha256base32(input: string | Uint8Array): Promise<Base32String>;
  generateAuthorKeypair(
    name: string,
  ): Promise<AuthorKeypair | ValidationError>;
  sign(
    keypair: AuthorKeypair,
    msg: string | Uint8Array,
  ): Promise<Base32String | ValidationError>;
  verify(
    authorAddress: AuthorAddress,
    sig: Base32String,
    msg: string | Uint8Array,
  ): Promise<boolean>;
  checkAuthorKeypairIsValid(
    keypair: AuthorKeypair,
  ): Promise<true | ValidationError>;
}

/** A crypto driver provides low-level access to an implementation providing ed25519 cryptography, e.g. Chloride, noble/ed25519, Node crypto. */
// These all handle Uint8Arrays (bytes)
export interface ICryptoDriver {
  sha256(input: string | Uint8Array): Promise<Uint8Array>;
  generateKeypairBytes(): Promise<KeypairBytes>;
  sign(
    keypairBytes: KeypairBytes,
    msg: string | Uint8Array,
  ): Promise<Uint8Array>;
  verify(
    publicKey: Uint8Array,
    sig: Uint8Array,
    msg: string | Uint8Array,
  ): Promise<boolean>;
}
