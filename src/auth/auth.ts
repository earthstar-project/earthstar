import { Meadowcap } from "../../deps.ts";
import { IdentityAddress, ShareAddress } from "../crypto/types.ts";
import { meadowcapParams } from "../parameters/schemes.ts";

export const meadowcap = new Meadowcap.Meadowcap(meadowcapParams);

export type Capability = Meadowcap.McCapability<
  ShareAddress,
  IdentityAddress,
  Uint8Array,
  Uint8Array
>;

export type AuthorisationToken = Meadowcap.MeadowcapAuthorisationToken<
  ShareAddress,
  IdentityAddress,
  Uint8Array,
  Uint8Array
>;
