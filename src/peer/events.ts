import type { Auth } from "../auth/auth.ts";
import type { ReadCapPack, WriteCapPack } from "../caps/types.ts";
import { AuthEvents, type KeypairAddPayload } from "../auth/events.ts";

export type PeerEventsMap = {
  [AuthEvents.KeypairAdd]: KeypairAddEvent;
  [AuthEvents.CapAdd]: CapAddEvent;
  [AuthEvents.CapDelegate]: CapDelegateEvent;
};

/** Emitted when a new keypair is added to the {@linkcode Peer} instance. */
export class KeypairAddEvent extends CustomEvent<KeypairAddPayload> {
  constructor(payload: KeypairAddPayload) {
    super(AuthEvents.KeypairAdd, { detail: payload });
  }
}

/** Emitted when a new capability is added to the {@linkcode Peer} instance. */
export class CapAddEvent extends CustomEvent<ReadCapPack | WriteCapPack> {
  constructor(payload: ReadCapPack | WriteCapPack) {
    super(AuthEvents.CapAdd, { detail: payload });
  }
}

/** Emitted when a capability is delegated in the {@linkcode Peer} instance. */
export class CapDelegateEvent extends CustomEvent<ReadCapPack | WriteCapPack> {
  constructor(payload: ReadCapPack | WriteCapPack) {
    super(AuthEvents.CapDelegate, { detail: payload });
  }
}

function handleKeypairAdd(event: Event, dispatcher: EventTarget) {
  dispatcher.dispatchEvent(
    new KeypairAddEvent((event as CustomEvent<KeypairAddPayload>).detail),
  );
}

function handleCapAdd(event: Event, dispatcher: EventTarget) {
  dispatcher.dispatchEvent(
    new CapAddEvent((event as CustomEvent<ReadCapPack | WriteCapPack>).detail),
  );
}

function handleCapDelegate(event: Event, dispatcher: EventTarget) {
  dispatcher.dispatchEvent(
    new CapDelegateEvent(
      (event as CustomEvent<ReadCapPack | WriteCapPack>).detail,
    ),
  );
}

export function relayAuthEvents(dispatcher: EventTarget, auth: Auth) {
  const keypairAddHandler = (event: Event) =>
    handleKeypairAdd(event, dispatcher);
  const capAddHandler = (event: Event) => handleCapAdd(event, dispatcher);
  const capDelegateHandler = (event: Event) =>
    handleCapDelegate(event, dispatcher);

  auth.addEventListener(AuthEvents.KeypairAdd, keypairAddHandler);
  auth.addEventListener(AuthEvents.CapAdd, capAddHandler);
  auth.addEventListener(AuthEvents.CapDelegate, capDelegateHandler);

  return () => {
    auth.removeEventListener(AuthEvents.KeypairAdd, keypairAddHandler);
    auth.removeEventListener(AuthEvents.CapAdd, capAddHandler);
    auth.removeEventListener(AuthEvents.CapDelegate, capDelegateHandler);
  };
}
