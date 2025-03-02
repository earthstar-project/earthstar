import type * as Willow from "@earthstar/willow";
import { StoreEvents as WillowEvents } from "@earthstar/willow";
import type { AuthorisationToken } from "../auth/auth.ts";
import type { Capability } from "../caps/types.ts";
import type {
  IdentityKeypairRaw,
  IdentityPublicKey,
} from "../identifiers/identity.ts";
import type { SharePublicKey } from "../identifiers/share.ts";
import { Path } from "../path/path.ts";
import { entryToDocument } from "../util/documents.ts";

import type { Document, PreFingerprint } from "./types.ts";

export const StoreEvents = {
  DocumentSet: "documentset",
  EntryIngest: "entryingest",
  EntryRemove: "entryremove",
  PayloadIngest: "payloadingest",
  PayloadRemove: "payloadRemove",
} as const;

export type StoreEventsMapping = {
  [StoreEvents.DocumentSet]: DocumentSetEvent;
  [StoreEvents.EntryIngest]: DocumentIngestEvent;
  [StoreEvents.EntryRemove]: DocumentRemoveEvent;
  [StoreEvents.PayloadIngest]: PayloadIngestEvent;
  [StoreEvents.PayloadRemove]: PayloadRemoveEvent;
};

/** Emitted after a {@linkcode Store} creates or updates a {@linkcode Document}. */
export class DocumentSetEvent extends CustomEvent<{ document: Document }> {
  constructor(document: Document) {
    super(StoreEvents.DocumentSet, { detail: { document } });
  }
}

/** Emitted after a {@linkcode Store} attempts to ingest a {@linkcode Document}. */
export class DocumentIngestEvent extends CustomEvent<{ document: Document }> {
  constructor(document: Document) {
    super(StoreEvents.EntryIngest, { detail: { document } });
  }
}

/** Emitted after a {@linkcode Store} attempts to ingest a payload. */
export class PayloadIngestEvent extends CustomEvent<{ document: Document }> {
  constructor(document: Document) {
    super(StoreEvents.PayloadIngest, { detail: { document } });
  }
}

/** Emitted after a {@linkcode Store} removes a {@linkcode Document}. */
export class DocumentRemoveEvent extends CustomEvent<{
  removed: Path;
  removedBy: Document;
}> {
  constructor(
    removed: Path,
    removedBy: Document,
  ) {
    super(StoreEvents.EntryRemove, {
      detail: {
        removed,
        removedBy,
      },
    });
  }
}

/** Emitted after a {@linkcode Store} removes a payload. */
export class PayloadRemoveEvent extends CustomEvent<{ removedBy: Document }> {
  constructor(removedBy: Document) {
    super(StoreEvents.PayloadRemove, { detail: { removedBy } });
  }
}

export function relayWillowEvents(
  dispatcher: EventTarget,
  willowStore: Willow.Store<
    SharePublicKey,
    IdentityPublicKey,
    Uint8Array,
    {
      cap: Capability;
      receiverKeypair: IdentityKeypairRaw;
    },
    AuthorisationToken,
    PreFingerprint,
    Uint8Array
  >,
) {
  const onEntryPayloadSet = (event: Event) => {
    const evt = event as Willow.EntryPayloadSetEvent<
      SharePublicKey,
      IdentityPublicKey,
      Uint8Array,
      AuthorisationToken
    >;

    dispatcher.dispatchEvent(
      new DocumentSetEvent(entryToDocument(
        evt.detail.entry,
        evt.detail.payload,
        evt.detail.authToken,
      )),
    );
  };

  willowStore.addEventListener(
    WillowEvents.EntryPayloadSet,
    onEntryPayloadSet,
  );

  const onEntryIngest = (event: Event) => {
    const evt = event as Willow.EntryIngestEvent<
      SharePublicKey,
      IdentityPublicKey,
      Uint8Array,
      AuthorisationToken
    >;

    dispatcher.dispatchEvent(
      new DocumentIngestEvent(entryToDocument(
        evt.detail.entry,
        undefined,
        evt.detail.authToken,
      )),
    );
  };

  willowStore.addEventListener(
    WillowEvents.EntryIngest,
    onEntryIngest,
  );

  const onPayloadIngest = (event: Event) => {
    const evt = event as Willow.PayloadIngestEvent<
      SharePublicKey,
      IdentityPublicKey,
      Uint8Array,
      AuthorisationToken
    >;

    dispatcher.dispatchEvent(
      new DocumentIngestEvent(entryToDocument(
        evt.detail.entry,
        evt.detail.payload,
        evt.detail.authToken,
      )),
    );
  };

  willowStore.addEventListener(
    WillowEvents.PayloadIngest,
    onPayloadIngest,
  );

  const onEntryRemove = (event: Event) => {
    const evt = event as Willow.EntryRemoveEvent<
      SharePublicKey,
      IdentityPublicKey,
      Uint8Array,
      AuthorisationToken
    >;

    dispatcher.dispatchEvent(
      new DocumentRemoveEvent(
        new Path(evt.detail.removed.path),
        entryToDocument(
          evt.detail.removedBy.entry,
          undefined,
          evt.detail.removedBy.authToken,
        ),
      ),
    );
  };

  willowStore.addEventListener(
    WillowEvents.EntryRemove,
    onEntryRemove,
  );

  const onPayloadRemove = (event: Event) => {
    const evt = event as Willow.PayloadRemoveEvent<
      SharePublicKey,
      IdentityPublicKey,
      Uint8Array,
      AuthorisationToken
    >;

    dispatcher.dispatchEvent(
      new PayloadRemoveEvent(
        entryToDocument(
          evt.detail.removedBy.entry,
          undefined,
          evt.detail.removedBy.authToken,
        ),
      ),
    );
  };

  willowStore.addEventListener(
    WillowEvents.PayloadRemove,
    onPayloadRemove,
  );

  return () => {
    willowStore.removeEventListener(
      WillowEvents.EntryPayloadSet,
      onEntryPayloadSet,
    );
    willowStore.removeEventListener(
      WillowEvents.EntryIngest,
      onEntryIngest,
    );
    willowStore.removeEventListener(
      WillowEvents.PayloadIngest,
      onPayloadIngest,
    );
    willowStore.removeEventListener(
      WillowEvents.EntryRemove,
      onEntryRemove,
    );
    willowStore.removeEventListener(
      WillowEvents.PayloadRemove,
      onPayloadRemove,
    );
  };
}
