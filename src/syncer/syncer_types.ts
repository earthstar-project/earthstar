import {
  AuthorAddress,
  DocBase,
  Path,
  ShareAddress,
} from "../util/doc-types.ts";
import { Replica } from "../replica/replica.ts";
import {
  FormatArg,
  FormatDocType,
  FormatsArg,
} from "../formats/format_types.ts";
import { TransferManager } from "./transfer_manager.ts";
import { SyncerManager } from "./syncer_manager.ts";
import { NotSupportedError } from "../util/errors.ts";

/** A short string with a timestamp and hash of the document's path and author. */
export type DocThumbnail = string;

export type RangeMessage =
  | {
    type: "EMPTY_SET";
    canRespond: boolean;
  }
  | {
    type: "LOWER_BOUND";
    value: DocThumbnail;
  }
  | {
    type: "PAYLOAD";
    payload: DocThumbnail;
    end?: { canRespond: boolean; upperBound: DocThumbnail };
  }
  | {
    type: "EMPTY_PAYLOAD";
    upperBound: DocThumbnail;
  }
  | {
    type: "FINGERPRINT";
    /** Base64 encoded version of the fingeprint. */
    fingerprint: string;
    upperBound: DocThumbnail;
  }
  | { type: "DONE"; upperBound: DocThumbnail }
  | { type: "TERMINAL" };

/** An event to be passed on to a RangeMessenger */
export type SyncAgentRangeMessageEvent = {
  kind: "RANGE_MSG";
  /** A JSON encoded message. */
  message: RangeMessage;
};

export type SyncAgentHaveEvent = {
  kind: "HAVE";
  thumbnail: DocThumbnail;
};

/** Signals that a SyncAgent wants a document/documents from another SyncAgent */
export type SyncAgentWantEvent = {
  kind: "WANT";
  thumbnail: DocThumbnail;
};

/** An event with an Earthstar document and corresponding ID. */
export type SyncAgentDocEvent = {
  kind: "DOC";
  thumbnail: DocThumbnail;
  doc: DocBase<string>;
  attachmentHeld: boolean;
};

export type SyncAgentWantAttachmentEvent = {
  kind: "WANT_ATTACHMENT";
  doc: DocBase<string>;
  shareAddress: string;
  attachmentHash: string;
};

/** An event sent when a SyncAgent doesn't want anything anymore, though it'll still serve HAVE requests. */
export type SyncAgentFulfilledEvent = {
  kind: "FULFILLED";
};

export type SyncAgentAbortEvent = {
  kind: "ABORT";
};

/** A special event for the implementation of a PlumTree. Asks the recipient to begin lazily messaging us. */
export type SyncAgentPruneEvent = {
  kind: "PRUNE";
};

export type SynceAgentNewAttachmentEvent = {
  kind: "NEW_ATTACHMENT";
  path: Path;
  author: AuthorAddress;
  format: string;
  hash: string;
};

/** A type of message one SyncAgent can send to another. */
export type SyncAgentEvent =
  | SyncAgentRangeMessageEvent
  | SyncAgentWantEvent
  | SyncAgentDocEvent
  | SyncAgentWantAttachmentEvent
  | SyncAgentAbortEvent
  | SyncAgentHaveEvent
  | SyncAgentPruneEvent
  | SynceAgentNewAttachmentEvent
  | SyncAgentFulfilledEvent;

/** The current status of a SyncAgent. */
export type SyncAgentStatus = {
  /** The number of documents requested by this agent */
  requestedCount: number;
  /** The number of documents received by this agent */
  receivedCount: number;
  /** The number of documents sent by this agent */
  sentCount: number;
  status: "preparing" | "reconciling" | "gossiping" | "done" | "aborted";
  // TODO: Add if partner is done yet.
};

export type SyncAgentOpts<F> = {
  replica: Replica;
  formats?: FormatsArg<F>;
  transferManager: TransferManager<F, unknown>;
  syncerManager: SyncerManager;
  syncAppetite: SyncAppetite;
  initiateMessaging: boolean;
  payloadThreshold: number;
  rangeDivision: number;
};

// ===================

/** An event for disclosing which shares a Peer has without actually revealing them. Another peer can use the salt to hash their own shares' addresses and see if they match. */
export type SyncerDiscloseEvent = {
  kind: "DISCLOSE";
  syncerId: string;
  salt: string;
  shares: string[];
  formats: string[];
  canRespond: boolean;
};

export type SyncerFulfilledEvent = {
  kind: "SYNCER_FULFILLED";
};

export type SyncerHeartbeat = {
  kind: "HEARTBEAT";
};

/** A SyncAgentEvent addressed to a specific share address. */
export type SyncerSyncAgentEvent = SyncAgentEvent & {
  to: string;
};

/** An event a Syncer can send or receive. */
export type SyncerEvent =
  | SyncerSyncAgentEvent
  | SyncerDiscloseEvent
  | SyncerHeartbeat
  | SyncerFulfilledEvent;

/** Provides a syncer with the means to connect the peer being synced with (the partner). */
export interface ISyncPartner<IncomingAttachmentSourceType> {
  /** */
  syncAppetite: SyncAppetite;

  /** The number of permitted concurrent attachment transfers */
  concurrentTransfers: number;

  /** The size at which a subdivided reconciliation range should send a fingerprint instead of items. **Must be at least 1**.
   *
   * A lower number mean fewer messages transmitted.
   */
  payloadThreshold: number;

  /** The number of subdivisions to make when splitting a mismatched range. **Must be at least 2**. */
  rangeDivision: number;

  /** An async iterable of events from the partner. */
  getEvents(): AsyncIterable<SyncerEvent>;

  /** Sends a syncer event to the partner. */
  sendEvent(event: SyncerEvent): Promise<void>;

  closeConnection(): Promise<void>;

  /** Attempt to download an attachment directly from the partner.
   * @returns A `ReadableStream<Uint8Array>` to read data from, `undefined` if this peer does not have the attachment, or `NotSupportedError` in the case that there is no way to initiate a transfer (e.g. in the case of a web server syncing with a browser).
   */
  getDownload(
    opts: GetTransferOpts,
  ): Promise<ReadableStream<Uint8Array> | undefined | NotSupportedError>;

  /** Handles (usually in-band) request from the other peer to upload an attachment.
   * @returns A `WritableStream<Uint8Array>` to write data to, or `undefined` in the case that there is no way to initiate a transfer (e.g. in the case of a web server syncing with a browser).
   */
  handleUploadRequest(
    opts: GetTransferOpts,
  ): Promise<WritableStream<Uint8Array> | NotSupportedError>;

  /** Handles an out-of-band request from the other peer to start a transfer.
   * @returns A `Readable<Uint8Array>` for a download, A `WritableStream<Uint8Array>` for an upload, `undefined` if a download request was made an we have no attachment to serve, or `NotSupportedError` in the case we do not expect to handle external requests (e.g. in the case of a browser syncing with a server).
   */
  handleTransferRequest(
    source: IncomingAttachmentSourceType,
    kind: "upload" | "download",
  ): Promise<
    | ReadableStream<Uint8Array>
    | WritableStream<Uint8Array>
    | undefined
    | NotSupportedError
  >;
}

// ===================

export type GetTransferOpts = {
  syncerId: string;
  doc: DocBase<string>;
  shareAddress: string;
  attachmentHash: string;
};

/** An 'appetite' which determines when the syncer will stop syncing.
 * - `once` - The syncer will only attempt to reconcile existing docs and then stop.
 * - `continuous` - Indefinite syncing, including existing docs and new ones as they are ingested into the replica.
 */
export type SyncAppetite = "once" | "continuous";

/** Options to initialise a Syncer with. */
export interface SyncerOpts<F, I> {
  /** The manager this syncer will be managed by. */
  manager: SyncerManager;
  /** Determines how sync messages will be sent and received */
  partner: ISyncPartner<I>;
  /** An optional array of formats to sync. Defaults to just `es.5`. */
  formats?: FormatsArg<F>;
}

/** A map of sync statuses by the share address they're associated with. */
export type SyncerStatus = Record<
  ShareAddress,
  {
    /** The status of document sync for a single share. */
    docs: SyncAgentStatus;
    /** The status of attachment transfers for a single share. */
    attachments: AttachmentTransferReport[];
  }
>;

// =============== Attachments

export type AttachmentTransferStatus =
  | "ready"
  | "in_progress"
  | "complete"
  | "failed"
  | "missing_attachment";

export type AttachmentTransferOpts<F> = {
  stream: ReadableStream<Uint8Array> | WritableStream<Uint8Array>;
  replica: Replica;
  doc: FormatDocType<F>;
  format: FormatArg<F>;
  requester: "us" | "them";
  counterpartId: "local" | string;
};

export type AttachmentTransferReport = {
  author: string;
  path: string;
  format: string;
  hash: string;
  status: AttachmentTransferStatus;
  /** The number of bytes transferred so far. */
  bytesLoaded: number;
  /** The total number of bytes of the data being transferred. */
  totalBytes: number;
  kind: "download" | "upload";
};

export type AttachmentTransferProgressEvent = {
  status: AttachmentTransferStatus;
  bytesLoaded: number;
  totalBytes: number;
};
