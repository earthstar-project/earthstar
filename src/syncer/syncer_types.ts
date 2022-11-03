import { DocBase, ShareAddress } from "../util/doc-types.ts";
import { IPeer } from "../peer/peer-types.ts";
import { Replica } from "../replica/replica.ts";
import {
  FormatArg,
  FormatDocType,
  FormatsArg,
} from "../formats/format_types.ts";
import { TransferManager } from "./transfer_manager.ts";

/** A short string describing the timestamp, author, and path of a document. */
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

/** Signals that a SyncAgent wants a document/documents from another SyncAgent */
export type SyncAgentWantEvent = {
  kind: "WANT";
  thumbnail: string;
};

/** An event with an Earthstar document and corresponding ID. */
export type SyncAgentDocEvent = {
  kind: "DOC";
  doc: DocBase<string>;
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

/** A type of message one SyncAgent can send to another. */
export type SyncAgentEvent =
  | SyncAgentRangeMessageEvent
  | SyncAgentWantEvent
  | SyncAgentDocEvent
  | SyncAgentWantAttachmentEvent
  | SyncAgentAbortEvent
  | SyncAgentFulfilledEvent;

/** The current status of a SyncAgent
 * - `requested`: The number of documents requested
 * - `received`: The number of requests responded to
 * - `status`: An overall status of the agent. `preparing` is when it is calculating its HAVE entries, `syncing` when it has unfulfilled requests, `idling` when there are no active requests, and `done` when it has been closed, or received all documents it was interested in.
 */
export type SyncAgentStatus = {
  requested: number;
  received: number;
  status: "preparing" | "syncing" | "idling" | "done" | "aborted";
  // TODO: Add if partner is done yet.
};

/** Options used for initialisng a `SyncAgent`.
 * - `replica`: The replica to represent.
 * - `mode`: Whether to sync only existing docs or keep the connection open for new docs too.
 */
export type SyncAgentOpts<F> = {
  replica: Replica;
  formats?: FormatsArg<F>;
  mode: "only_existing" | "live";
  transferManager: TransferManager<F, unknown>;
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

  /** Attempt to download an attachment directly from the partner.
   * @returns A `ReadableStream<Uint8Array>` to read data from, a `ValidationError` if something went wrong, or `undefined` in the case that there is no way to initiate a transfer (e.g. in the case of a web server syncing with a browser).
   */
  getDownload(
    opts: GetTransferOpts,
  ): Promise<ReadableStream<Uint8Array> | undefined>;

  /** Handles (usually in-band) request from the other peer to upload an attachment.
   * @returns A `WritableStream<Uint8Array>` to write data to, or `undefined` in the case that there is no way to initiate a transfer (e.g. in the case of a web server syncing with a browser).
   */
  handleUploadRequest(
    opts: GetTransferOpts,
  ): Promise<WritableStream<Uint8Array> | undefined>;

  /** Handles an out-of-band request from the other peer to start a transfer.
   * @returns A `Readable<Uint8Array>` for a download, A `WritableStream<Uint8Array>` for an upload, or `undefined` in the case we do not expect to handle external requests (e.g. in the case of a browser syncing with a server).
   */
  handleTransferRequest(
    source: IncomingAttachmentSourceType,
    kind: "upload" | "download",
  ): Promise<
    | ReadableStream<Uint8Array>
    | WritableStream<Uint8Array>
    | undefined
  >;
}

// ===================

export type GetTransferOpts = {
  syncerId: string;
  doc: DocBase<string>;
  shareAddress: string;
  attachmentHash: string;
};

/** A mode which determines when the syncer will stop syncing.
 * - `once` - The syncer will only attempt to sync existing docs and then stop.
 * - `live` - Indefinite syncing, including existing docs and new ones as they are ingested into the replica.
 */
export type SyncerMode = "once" | "live";

/** Options to initialise a Syncer with.
 * - `peer` - The peer to synchronise.
 * - `partner` - Determines who you'll be syncing with (e.g. a remote peer on a server, a local peer)
 * - `mode` - Determines what kind of sync to carry out.
 * - `formats` - An optional array of formats to sync. Defaults to just `es.5`.
 */
export interface SyncerOpts<F, I> {
  peer: IPeer;
  partner: ISyncPartner<I>;
  mode: SyncerMode;
  formats?: FormatsArg<F>;
}

/** A map of sync statuses by the share address they're associated with. */
export type SyncerStatus = Record<
  ShareAddress,
  {
    docs: SyncAgentStatus;
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
};

export type AttachmentTransferReport = {
  author: string;
  path: string;
  format: string;
  hash: string;
  status: AttachmentTransferStatus;
  bytesLoaded: number;
  totalBytes: number;
  kind: "download" | "upload";
};

export type AttachmentTransferProgressEvent = {
  status: AttachmentTransferStatus;
  bytesLoaded: number;
  totalBytes: number;
};
