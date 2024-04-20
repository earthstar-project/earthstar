import { Base32String } from "../encoding/types.ts";

/** An identity's public address. */
export type IdentityAddress = string;
/** The human-identifiable portion of an identity's public address, e.g. `suzy`. */
export type IdentityShortname = string;
/** A share's public address. */
export type ShareAddress = string;
/** The human-identifiable portion of a share's address, e.g. `gardening`. */
export type ShareName = string;

export type ParsedAddress = {
  address: string;
  name: string;
  pubkey: Base32String;
};

export type IdentityKeypair<PrivateKey> = {
  identityAddress: string;
  privateKey: PrivateKey;
};

export type OwnedNamespaceKeypair<PrivateKey> = {
  shareAddress: string;
  privateKey: PrivateKey;
};

export interface CryptoDriver<PrivateKey> {
  generateKeypair(): Promise<{
    publicKey: Uint8Array;
    privateKey: PrivateKey;
  }>;
  sign(
    bytes: Uint8Array,
    privateKey: PrivateKey,
  ): Promise<Uint8Array>;
  verify(
    publicKey: Uint8Array,
    signature: Uint8Array,
    bytes: Uint8Array,
  ): Promise<boolean>;
}
