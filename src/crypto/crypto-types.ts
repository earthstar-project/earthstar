import {
  AuthorAddress,
  Base32String,
  ShareAddress,
} from "../util/doc-types.ts";
import { ValidationError } from "../util/errors.ts";
import { UpdatableHash } from "./updatable_hash.ts";

export interface KeypairBytes {
  pubkey: Uint8Array;
  secret: Uint8Array;
}

/** A keypair used by individual entities to sign documents. */
export interface AuthorKeypair {
  address: AuthorAddress;
  secret: string;
}

/** A keypair used to write to a specific share */
export type ShareKeypair = {
  shareAddress: ShareAddress;
  secret: string;
};

/** Higher-level crypto functions. Not used directly for the most part, but useful for generating new keypairs. */
// These all handle base32-encoded strings.
export interface ICrypto {
  sha256base32(
    input: string | Uint8Array,
  ): Promise<Base32String>;
  updatableSha256(): UpdatableHash<any>;
  generateAuthorKeypair(
    name: string,
  ): Promise<AuthorKeypair | ValidationError>;
  generateShareKeypair(
    name: string,
  ): Promise<ShareKeypair | ValidationError>;
  sign(
    keypair: AuthorKeypair | ShareKeypair,
    msg: string | Uint8Array,
  ): Promise<Base32String | ValidationError>;
  verify(
    address: AuthorAddress | ShareAddress,
    sig: Base32String,
    msg: string | Uint8Array,
  ): Promise<boolean>;
  checkKeypairIsValid(
    keypair: AuthorKeypair | ShareKeypair,
  ): Promise<true | ValidationError>;
}

/** A crypto driver provides low-level access to an implementation providing ed25519 cryptography, e.g. Chloride, noble/ed25519, Node crypto. */
// These all handle Uint8Arrays (bytes)
export interface ICryptoDriver {
  sha256(
    input: string | Uint8Array,
  ): Promise<Uint8Array>;
  updatableSha256(): UpdatableHash<any>;
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
