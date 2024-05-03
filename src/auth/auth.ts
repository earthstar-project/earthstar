import { Meadowcap } from "../../deps.ts";
import { IdentityPublicKey } from "../identifiers/identity.ts";
import { SharePublicKey } from "../identifiers/share.ts";

import { meadowcapParams } from "../schemes/schemes.ts";

export const meadowcap = new Meadowcap.Meadowcap(meadowcapParams);

export type Capability = Meadowcap.McCapability<
  SharePublicKey,
  IdentityPublicKey,
  Uint8Array,
  Uint8Array
>;

export type AuthorisationToken = Meadowcap.MeadowcapAuthorisationToken<
  SharePublicKey,
  IdentityPublicKey,
  Uint8Array,
  Uint8Array
>;
