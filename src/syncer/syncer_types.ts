import { DocBase, ShareAddress, Timestamp } from "../util/doc-types.ts";
import { IPeer } from "../peer/peer-types.ts";
import { Replica } from "../replica/replica.ts";
import {
  FormatArg,
  FormatDocType,
  FormatsArg,
} from "../formats/format_types.ts";
import { ValidationError } from "../util/errors.ts";

/** Describes a group of docs under a common path which a syncing replica possesses. */
export type HaveEntry = {
  id: string;
  versions: Record<string, Timestamp>;
};

/** A mode describing whether the HaveEntryKeeper should process only existing docs, or also live ones. */
export type HaveEntryKeeperMode = "existing" | "everything";

/** A hash of a replica's entire store of documents, used to quickly check equivalence. */
export type SyncAgentHashEvent = {
  kind: "HASH";
  hash: string;
};

/** A compressed description of a group of docs a sync agent possesses */
export interface SyncAgentHaveEvent extends HaveEntry {
  kind: "HAVE";
}

/** Signals that a SyncAgent wants a document/documents from another SyncAgent */
export type SyncAgentWantEvent = {
  kind: "WANT";
  id: string;
};

/** An event with an Earthstar document and corresponding ID. */
export type SyncAgentDocEvent = {
  kind: "DOC";
  id: string;
  doc: DocBase<string>;
};

/** An event sent when a SyncAgent doesn't want anything anymore, though it'll still serve HAVE requests. */
export type SyncAgentFinishedEvent = {
  kind: "DONE";
};

export type SyncAgentAbortEvent = {
  kind: "ABORT";
};

/** A type of message one SyncAgent can send to another. */
export type SyncAgentEvent =
  | SyncAgentHashEvent
  | SyncAgentHaveEvent
  | SyncAgentWantEvent
  | SyncAgentDocEvent
  | SyncAgentAbortEvent
  | SyncAgentFinishedEvent;

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
};

// ===================

/** An event for disclosing which shares a Peer has without actually revealing them. Another peer can use the salt to hash their own shares' addresses and see if they match. */
export type SyncerDiscloseEvent = {
  kind: "DISCLOSE";
  salt: string;
  shares: string[];
  formats: string[];
};

export type SyncerRequestAttachmentTransferEvent = {
  kind: "BLOB_REQ";
  /** An ID to be used for an external request to find its way back to this syncer. */
  syncerId: string;
  doc: DocBase<string>;
  shareAddress: string;
  attachmentHash: string;
};

/** A SyncAgentEvent addressed to a specific share address. */
export type SyncerSyncAgentEvent = SyncAgentEvent & {
  to: string;
};

/** An event a Syncer can send or receive. */
export type SyncerEvent =
  | SyncerSyncAgentEvent
  | SyncerDiscloseEvent
  | SyncerRequestAttachmentTransferEvent;

export interface ISyncPartner<IncomingAttachmentSourceType> {
  readable: ReadableStream<SyncerEvent>;
  writable: WritableStream<SyncerEvent>;
  // request transfer (ie. a download)
  getDownload(
    opts: GetTransferOpts,
  ): Promise<ReadableStream<Uint8Array> | ValidationError | undefined>;
  // handle (internal) request to initiate transfer (ie. an upload)
  handleUploadRequest(
    opts: GetTransferOpts,
  ): Promise<WritableStream<Uint8Array> | ValidationError | undefined>;
  // handle (external) request to initiate transfer.
  handleTransferRequest(
    source: IncomingAttachmentSourceType,
    kind: "upload" | "download",
  ): Promise<
    | ReadableStream<Uint8Array>
    | WritableStream<Uint8Array>
    | ValidationError
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
 * - `driver` - Determines who you'll be syncing with (e.g. a remote peer on a server, a local peer)
 * - `mode` - Determines what kind of sync to carry out.
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
    attachments: {
      author: string;
      path: string;
      format: string;
      hash: string;
      status: AttachmentTransferStatus;
      bytesLoaded: number;
      totalBytes: number;
    }[];
  }
>;

// =============== BLOB SYNCING

export type AttachmentTransferStatus =
  | "ready"
  | "in_progress"
  | "complete"
  | "failed";

export type AttachmentTransferOpts<F> = {
  stream: ReadableStream<Uint8Array> | WritableStream<Uint8Array>;
  replica: Replica;
  doc: FormatDocType<F>;
  format: FormatArg<F>;
};

export type AttachmentTransferProgressEvent = {
  status: AttachmentTransferStatus;
  bytesLoaded: number;
  totalBytes: number;
};
