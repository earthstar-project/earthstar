import type {
  McCapability,
  McSubspaceCapability,
  ReadCapability as McReadCapability,
  WriteCapability as McWriteCapability,
} from "@earthstar/meadowcap";
import type { IdentityPublicKey } from "../identifiers/identity.ts";
import type { SharePublicKey } from "../identifiers/share.ts";

/** An unforgeable token bestowing access to some resource. */
export type Capability = McCapability<
  SharePublicKey,
  IdentityPublicKey,
  Uint8Array,
  Uint8Array
>;

export type ReadCapability = McReadCapability<
  SharePublicKey,
  IdentityPublicKey,
  Uint8Array,
  Uint8Array
>;

export type WriteCapability = McWriteCapability<
  SharePublicKey,
  IdentityPublicKey,
  Uint8Array,
  Uint8Array
>;

/** An unforgeable token proving that the holder of an identity keypair is authorised to know about arbitrary identities in an owned share. */
export type SubspaceCapability = McSubspaceCapability<
  SharePublicKey,
  IdentityPublicKey,
  Uint8Array,
  Uint8Array
>;

export type ReadCapPack = {
  readCap: ReadCapability;
  subspaceCap?: SubspaceCapability;
};

export type WriteCapPack = {
  writeCap: WriteCapability;
};
