import {
  DocBase,
  DocInputBase,
  ShareAddress,
  Timestamp,
} from "../util/doc-types.ts";
import { IPeer } from "../peer/peer-types.ts";
import { Replica } from "../replica/replica.ts";
import { IFormat } from "../formats/format_types.ts";
import { OptionalFormats } from "../formats/default.ts";

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
};

/** Options used for initialisng a `SyncAgent`.
 * - `replica`: The replica to represent.
 * - `mode`: Whether to sync only existing docs or keep the connection open for new docs too.
 */
export type SyncAgentOpts<F> = {
  replica: Replica;
  formats: OptionalFormats<F>;
  mode: "only_existing" | "live";
};

// ===================

/** An event for disclosing which shares a Peer has without actually revealing them. Another peer can use the salt to hash their own shares' addresses and see if they match. */
export type SyncerDiscloseEvent = {
  kind: "DISCLOSE";
  salt: string;
  shares: string[];
};

/** A SyncAgentEvent addressed to a specific share address. */
export type SyncerSyncAgentEvent = SyncAgentEvent & {
  to: string;
};

/** An event a Syncer can send or receive. */
export type SyncerEvent = SyncerSyncAgentEvent | SyncerDiscloseEvent;

export interface ISyncPartner {
  readable: ReadableStream<SyncerEvent>;
  writable: WritableStream<SyncerEvent>;
}

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
export interface SyncerOpts<F> {
  peer: IPeer;
  partner: ISyncPartner;
  mode: SyncerMode;
  formats: OptionalFormats<F>;
}

/** A map of sync statuses by the share address they're associated with. */
export type SyncerStatus = Record<ShareAddress, SyncAgentStatus>;
