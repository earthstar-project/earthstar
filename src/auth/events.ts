import type { ReadCapPack, WriteCapPack } from "../caps/types.ts";
import type { IdentityKeypairRaw } from "../identifiers/identity.ts";
import type { ShareKeypairRaw } from "../identifiers/share.ts";
import type { Auth } from "./auth.ts";

export const AuthEvents = {
  CapAdd: "capadd",
  CapDelegate: "capdelegate",
  KeypairAdd: "keypairadd",
  Ready: "ready",
} as const;

type KeypairAddPayload =
  | { type: "IDENTITY"; keypair: IdentityKeypairRaw }
  | { type: "SHARE"; keypair: ShareKeypairRaw };

export type AuthMappedEvents = {
  [AuthEvents.KeypairAdd]: CustomEvent<KeypairAddPayload>;
  [AuthEvents.CapAdd]: CustomEvent<ReadCapPack | WriteCapPack>;
  [AuthEvents.Ready]: CustomEvent<Auth>;
};

// todo: Add Custom Event classes with documentation
