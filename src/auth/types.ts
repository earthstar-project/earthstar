import { Area } from "@earthstar/willow-utils";
import { IdentityPublicKey } from "../identifiers/identity.ts";
import { SharePublicKey } from "../identifiers/share.ts";

export type CapPackSelector = {
  /** The share which a cap pack must belong to. */
  share: SharePublicKey;
  /** An optional list of areas, any of which the selected cap pack must fall into. */
  areas?: Area<IdentityPublicKey>[];
};
