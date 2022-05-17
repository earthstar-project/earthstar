import { CoreDoc, IReplica } from "../replica/replica-types.ts";
import { ShareAddress, Timestamp } from "../util/doc-types.ts";
import { IPeer } from "../peer/peer-types.ts";

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
  doc: CoreDoc;
};

/** An event sent when a SyncAgent doesn't want anything anymore, though it'll still serve HAVE requests. */
export type SyncAgentFinishedEvent = {
  kind: "DONE";
};

/** A type of message one SyncAgent can send to another. */
export type SyncAgentEvent =
  | SyncAgentHashEvent
  | SyncAgentHaveEvent
  | SyncAgentWantEvent
  | SyncAgentDocEvent
  | SyncAgentFinishedEvent;

/** The current status of a SyncAgent
 * - `requested`: The number of documents requested
 * - `received`: The number of requests responded to
 * - `status`: An overall status of the agent. `preparing` is when it is calculating its HAVE entries, `syncing` when it has unfulfilled requests, `idling` when there are no active requests, and `done` when it has been closed, or received all documents it was interested in.
 */
export type SyncAgentStatus = {
  requested: number;
  received: number;
  status: "preparing" | "syncing" | "idling" | "done";
};

/** Options used for initialisng a `SyncAgent`.
 * - `replica`: The replica to represent.
 * - `mode`: Whether to sync only existing docs or keep the connection open for new docs too.
 */
export type SyncAgentOpts = {
  replica: IReplica;
  mode: "only_existing" | "live";
};

// ===================

export type SyncerDiscloseEvent = {
  kind: "DISCLOSE";
  salt: string;
  shares: string[];
};

export type SyncerSyncAgentEvent = SyncAgentEvent & {
  to: string;
};

export type SyncerEvent = SyncerSyncAgentEvent | SyncerDiscloseEvent;

export interface ISyncerDriver {
  readable: ReadableStream<SyncerEvent>;
  writable: WritableStream<SyncerEvent>;
}

export type SyncerMode = "once" | "live";

export interface SyncerOpts {
  peer: IPeer;
  driver: ISyncerDriver;
  mode: SyncerMode;
}

export type SyncerStatus = Record<ShareAddress, SyncAgentStatus>;
