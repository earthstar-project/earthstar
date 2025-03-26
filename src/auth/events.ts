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

export type AuthEventsMap = {
  [AuthEvents.KeypairAdd]: KeypairAddEvent;
  [AuthEvents.CapAdd]: CapAddEvent;
  [AuthEvents.CapDelegate]: CapDelegateEvent;
  [AuthEvents.Ready]: ReadyEvent;
};

/**
 * Emitted when a new keypair is added to the {@linkcode Auth} instance.
 */
export class KeypairAddEvent extends CustomEvent<KeypairAddPayload> {
  constructor(payload: KeypairAddPayload) {
    super(AuthEvents.KeypairAdd, { detail: payload });
  }
}

/**
 * Emitted when a new capability is added to the {@linkcode Auth} instance.
 */
export class CapAddEvent extends CustomEvent<ReadCapPack | WriteCapPack> {
  constructor(payload: ReadCapPack | WriteCapPack) {
    super(AuthEvents.CapAdd, { detail: payload });
  }
}

/**
 * Emitted when a capability is delegated in the {@linkcode Auth} instance.
 */
export class CapDelegateEvent extends CustomEvent<ReadCapPack | WriteCapPack> {
  constructor(payload: ReadCapPack | WriteCapPack) {
    super(AuthEvents.CapDelegate, { detail: payload });
  }
}

/**
 * Emitted when the {@linkcode Auth} instance is ready to be used.
 */
export class ReadyEvent extends CustomEvent<Auth> {
  constructor(payload: Auth) {
    super(AuthEvents.Ready, { detail: payload });
  }
}
