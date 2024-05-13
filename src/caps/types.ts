import { Meadowcap } from "../../deps.ts";
import { IdentityPublicKey } from "../identifiers/identity.ts";
import { SharePublicKey } from "../identifiers/share.ts";

/** An unforgeable token bestowing access to some resource. */
export type Capability = Meadowcap.McCapability<
  SharePublicKey,
  IdentityPublicKey,
  Uint8Array,
  Uint8Array
>;

/** An unforgeable token proving that the holder of an identity keypair is authorised to know about arbitrary identities in an owned share. */
export type SubspaceCapability = Meadowcap.McSubspaceCapability<
  SharePublicKey,
  IdentityPublicKey,
  Uint8Array,
  Uint8Array
>;

export type ReadCapPack = {
  readCap: Meadowcap.ReadCapability<
    SharePublicKey,
    IdentityPublicKey,
    Uint8Array,
    Uint8Array
  >;
  subspaceCap?: Meadowcap.McSubspaceCapability<
    SharePublicKey,
    IdentityPublicKey,
    Uint8Array,
    Uint8Array
  >;
};
export type WriteCapPack = {
  writeCap: Meadowcap.WriteCapability<
    SharePublicKey,
    IdentityPublicKey,
    Uint8Array,
    Uint8Array
  >;
};
