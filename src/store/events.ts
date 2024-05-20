import * as Willow from "@earthstar/willow";
import { AuthorisationToken } from "../auth/auth.ts";
import { Capability } from "../caps/types.ts";
import {
  IdentityKeypairRaw,
  IdentityPublicKey,
} from "../identifiers/identity.ts";
import { SharePublicKey } from "../identifiers/share.ts";
import { Path } from "../path/path.ts";
import { entryToDocument } from "../util/documents.ts";

import { Document, PreFingerprint } from "./types.ts";

export class DocumentSetEvent extends CustomEvent<{ document: Document }> {
  constructor(document: Document) {
    super("documentset", { detail: { document } });
  }
}

export class DocumentIngestEvent extends CustomEvent<{ document: Document }> {
  constructor(document: Document) {
    super("entryingest", { detail: { document } });
  }
}

export class PayloadIngestEvent extends CustomEvent<{ document: Document }> {
  constructor(document: Document) {
    super("payloadingest", { detail: { document } });
  }
}

export class DocumentRemoveEvent extends CustomEvent<{
  removed: Path;
  removedBy: Document;
}> {
  constructor(
    removed: Path,
    removedBy: Document,
  ) {
    super("entryremove", {
      detail: {
        removed,
        removedBy,
      },
    });
  }
}

export class PayloadRemoveEvent extends CustomEvent<{ removedBy: Document }> {
  constructor(removedBy: Document) {
    super("payloadRemove", { detail: { removedBy } });
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

  willowStore.addEventListener("entrypayloadset", onEntryPayloadSet);

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
    "entryingest",
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
    "payloadingest",
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
    "entryremove",
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
    "payloadremove",
    onPayloadRemove,
  );

  return () => {
    willowStore.removeEventListener("entrypayloadset", onEntryPayloadSet);
    willowStore.removeEventListener("entryingest", onEntryIngest);
    willowStore.removeEventListener("payloadingest", onPayloadIngest);
    willowStore.removeEventListener("entryremove", onEntryRemove);
    willowStore.removeEventListener("payloadremove", onPayloadRemove);
  };
}
