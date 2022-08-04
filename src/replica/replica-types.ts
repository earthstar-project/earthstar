import {
  DocBase,
  DocAttachment,
  FormatName,
  ShareAddress,
} from "../util/doc-types.ts";
import { Query } from "../query/query-types.ts";
import { ValidationError } from "../util/errors.ts";
import { Replica } from "./replica.ts";
import { FormatsArg } from "../formats/default.ts";

//================================================================================
// TYPES AND EVENTS

export type ReplicaId = string;

// IngestEvents are returned from replica.set() and replica.ingest(),
// and sent as events on the replica.bus 'ingest' channel.

export interface IngestEventFailure {
  kind: "failure";
  reason: "write_error" | "invalid_document";
  err: Error | null;
}
export interface IngestEventNothingHappened<
  DocType extends DocBase<string>,
> {
  kind: "nothing_happened";
  reason: "obsolete_from_same_author" | "already_had_it";
  doc: DocType; // won't have a _localIndex because it was not actually ingested
}
export interface IngestEventSuccess<
  DocType extends DocBase<string>,
> {
  kind: "success";
  maxLocalIndex: number;
  doc: DocType; // the just-written doc, frozen, with updated extra properties like _localIndex

  docIsLatest: boolean; // is it the latest at this path (for any author)?

  // the most recent doc from the same author, at this path, before the new doc was written.
  prevDocFromSameAuthor: DocType | null;

  // the latest doc from any author at this path, before the new doc was written.
  // note this is actually still the latest doc if the just-written doc is an older one (docIsLatest===false)
  prevLatestDoc: DocType | null;
}
export interface DocAlreadyExists<
  DocType extends DocBase<string>,
> {
  // for a doc that was previously ingested, when a live query is catching up.
  kind: "existing";
  doc: DocType; // the just-written doc, frozen, with updated extra properties like _localIndex

  //docIsLatest: boolean,  // is it the latest at this path (for any author)?

  //// the most recent doc from the same author, at this path, before the new doc was written.
  //prevDocFromSameAuthor: Doc | null,

  //// the latest doc from any author at this path, before the new doc was written.
  //// note this is actually still the latest doc if the just-written doc is an older one (docIsLatest===false)
  //prevLatestDoc: Doc | null,
}
export interface ReplicaEventWillClose {
  kind: "willClose";
}
export interface ReplicaEventDidClose {
  kind: "didClose";
}

export interface ExpireEvent<
  DocType extends DocBase<string>,
> {
  kind: "expire";
  doc: DocType;
}

export interface AttachmentIngestEvent<DocType extends DocBase<string>> {
  kind: "attachment_ingest";
  doc: DocType;
  hash: string;
  size: number;
}

export interface AttachmentPruneEvent {
  kind: "attachment_prune";
  hash: string;
  format: string;
}

/**
 * - IngestEventSuccess — a new doc was written
 * - IngestEventFailure — refused an invalid doc
 * - IngestEventNothingHappened — ingested an obsolete or duplicate doc
 */
export type IngestEvent<
  DocType extends DocBase<string>,
> =
  | IngestEventFailure
  | IngestEventNothingHappened<DocType>
  | IngestEventSuccess<DocType>;

/**
 * - DocAlreadyExists — processing an old doc as you catch up
 * - IngestEvent — the result of a replica ingesting a document
 * - ExpireEvent - An ephemeral document has expired
 * - ReplicaEventWillClose — the replica is about to close
 * - ReplicaEventDidClose — the replica has closed
 */
export type ReplicaEvent<
  DocType extends DocBase<string>,
> =
  | IngestEvent<DocType>
  | ExpireEvent<DocType>
  | AttachmentIngestEvent<DocType>
  | AttachmentPruneEvent
  | ReplicaEventWillClose
  | ReplicaEventDidClose;

//================================================================================

// Query events

/** An event representing when a QuerySource has processed all existing documents. */
export type ProcessedAllExistingEvent = {
  kind: "processed_all_existing";
};

/**
 * - ExpireEvent - An ephemeral document has expired
 * - IngestEvent — the result of a replica ingesting a document
 * - DocAlreadyExists — processing an old doc as you catch up
 */
export type QuerySourceEvent<DocType extends DocBase<string>> =
  | ExpireEvent<DocType>
  | IngestEventSuccess<DocType>
  | ProcessedAllExistingEvent
  | DocAlreadyExists<DocType>;

export type QuerySourceOpts<F> = {
  replica: Replica;
  formats?: FormatsArg<F>;
  query: Omit<Query<string[]>, "formats">;
  mode?: QuerySourceMode;
};

/**
 * A mode representing what kind of docs are desired from a query stream.
 * - `existing` - Only pre-existing documents.
 * - `new` - Only documents written after the stream is initiated
 * - `everything` - Both pre-existing and incoming documents.
 */
export type QuerySourceMode = "existing" | "new" | "everything";

//================================================================================

export interface IReplicaConfig {
  // These methods will be mixed into the IReplica.
  // This is for local replica of configuration details for replica instances.
  // This data will not be directly sync'd with other instances.
  // replica drivers implement these, and IReplica just has stubs of
  // these methods that call out to the replica driver.
  getConfig(key: string): Promise<string | undefined>;
  setConfig(key: string, value: string): Promise<void>;
  listConfigKeys(): Promise<string[]>; // sorted
  deleteConfig(key: string): Promise<boolean>;
}

/**
 * A replica driver provides low-level access to actual replica and is used by IReplica to actually load and save data. ReplicaDrivers are not meant to be used directly by users; let the Replica talk to it for you.
 */
export interface IReplicaDocDriver extends IReplicaConfig {
  share: ShareAddress;
  //--------------------------------------------------
  // LIFECYCLE

  /** Returns if the replica has been closed or not. */
  isClosed(): boolean;

  /**
   * Close the replica Driver.
   * The replica will call this.
   * You cannot call close() if the replica is already closed (it will throw a ReplicaIsClosedError).
   * If erase, actually delete and forget data locally.
   * Erase defaults to false if not provided.
   */
  close(erase: boolean): Promise<void>;

  //--------------------------------------------------
  // GET

  /** The max local index used so far. */
  // The first doc will increment this and get index 1.
  // This is synchronous because it's expected that the driver will
  // load it once at startup and then keep it in memory.
  getMaxLocalIndex(): number;

  /** Returns an array of Docs given a Query. */
  // these should return frozen docs
  queryDocs(query: Query<string[]>): Promise<DocBase<string>[]>;
  //    queryPaths(query: Query): Doc[];
  // TODO: add a special getAllDocsAtPath for use by ingest?

  //--------------------------------------------------
  // SET

  /** Add or update a signed document. */
  // do no checks of any kind, just save it to the indexes
  // add a doc.  don't enforce any rules on it.
  // overwrite existing doc even if this doc is older.
  // return a copy of the doc, frozen, with _localIndex set.
  upsert<
    N extends FormatName,
    DocType extends DocBase<N>,
  >(
    doc: DocType,
  ): Promise<DocType>;

  /** Erase all expired docs from the replica permanently, leaving no trace of the documents. Returns the paths of the expired documents. */
  eraseExpiredDocs(): Promise<DocBase<string>[]>;
}

/** Options for configuring a new replica.
 * - `validators`: Validators for the kinds of documents this replica will replicate, e.g. FormatValidatorEs4.
 * - `driver`: A driver the replica will use to read and persist documents.
 */
export interface ReplicaOpts {
  driver: IReplicaDriver;
}

export interface IReplicaAttachmentDriver {
  getAttachment(
    formatName: string,
    attachmentHash: string,
  ): Promise<DocAttachment | undefined>;

  /** Upserts the attachment to a staging area, and returns an object used to assess whether it is what we're expecting */
  stage(
    formatName: string,
    attachment: Uint8Array | ReadableStream<Uint8Array>,
  ): Promise<
    {
      hash: string;
      size: number;
      commit: () => Promise<void>;
      reject: () => Promise<void>;
    } | ValidationError
  >;

  /** Erases an attachment for a given format and hash.*/
  erase(
    formatName: string,
    attachmentHash: string,
  ): Promise<true | ValidationError>;

  /** Erase all stored attachments */
  wipe(): Promise<void>;

  /** Delete all stored attachments not included in the provided list of hashes and their formats.
   * @returns An array of all erased hashes and their formats.
   */
  filter(
    attachments: Record<string, Set<string>>,
  ): Promise<{ format: string; hash: string }[]>;

  /** Reject all attachments waiting in staging. */
  clearStaging(): Promise<void>;
}

export interface IReplicaDriver {
  docDriver: IReplicaDocDriver;
  attachmentDriver: IReplicaAttachmentDriver;
}
