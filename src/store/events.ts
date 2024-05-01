import { Willow } from "../../deps.ts";
import { AuthorisationToken, Capability } from "../auth/auth.ts";
import { IdentityAddress, ShareAddress } from "../crypto/types.ts";
import { entryToDocument } from "../util/documents.ts";
import { willowToEarthstarPath } from "../util/path.ts";
import { Document, Path } from "./types.ts";

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
    ShareAddress,
    IdentityAddress,
    ArrayBuffer,
    {
      cap: Capability;
      receiverSecret: Uint8Array;
    },
    AuthorisationToken,
    ArrayBuffer
  >,
) {
  const onEntryPayloadSet = (event: Event) => {
    const evt = event as Willow.EntryPayloadSetEvent<
      ShareAddress,
      IdentityAddress,
      ArrayBuffer,
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
      ShareAddress,
      IdentityAddress,
      ArrayBuffer,
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
      ShareAddress,
      IdentityAddress,
      ArrayBuffer,
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
      ShareAddress,
      IdentityAddress,
      ArrayBuffer,
      AuthorisationToken
    >;

    dispatcher.dispatchEvent(
      new DocumentRemoveEvent(
        willowToEarthstarPath(evt.detail.removed.path),
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
      ShareAddress,
      IdentityAddress,
      ArrayBuffer,
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
