import {
  AuthorAddress,
  AuthorKeypair,
  DocBase,
  DocInputBase,
  FormatName,
  LocalIndex,
  Path,
  ShareAddress,
} from "../util/doc-types.ts";
import { HistoryMode, Query } from "../query/query-types.ts";
import {
  ExtractDocType,
  ExtractInputType,
  ExtractValidatorWithFormat,
  IFormatValidator,
} from "../format-validators/format-validator-types.ts";
import { Superbus } from "../superbus/superbus.ts";
import { ValidationError } from "../util/errors.ts";

//================================================================================
// TYPES AND EVENTS

export type ReplicaId = string;

export type ReplicaBusChannel =
  | "ingest"
  | // 'write|/some/path.txt'  // note that write errors and no-ops are also sent here
  "expire"
  | "willClose"
  | "didClose";

export interface QueryResult<
  FormatType extends FormatName,
  DocType extends DocBase<FormatType>,
> {
  // the docs from the query...
  docs: DocType[];
  // ...and the replica Driver's maxLocalIndex at the time
  // just before and just after the query was done.
  // This provided a lower and upper bound for the maxLocalIndex
  // associated with the resulting docs.
  // (This is the OVERALL max local index for
  // the whole replica, not just for the resulting docs.)
  maxLocalIndexBefore: number;
  maxLocalIndexAfter: number;
  // The max localIndex out of the returned docs.
  // This could be much smaller than the overall maxLocalIndex
  // if the docs have been filtered.
  // If there are no matching docs, this is -1.
  maxLocalIndexInResult: number;
}

// IngestEvents are returned from replica.set() and replica.ingest(),
// and sent as events on the replica.bus 'ingest' channel.

export interface IngestEventFailure {
  kind: "failure";
  reason: "write_error" | "invalid_document";
  maxLocalIndex: number;
  err: Error | null;
}
export interface IngestEventNothingHappened<
  FormatType extends FormatName,
  DocType extends DocBase<FormatType>,
> {
  kind: "nothing_happened";
  reason: "obsolete_from_same_author" | "already_had_it";
  maxLocalIndex: number;
  doc: DocType; // won't have a _localIndex because it was not actually ingested
}
export interface IngestEventSuccess<
  FormatType extends FormatName,
  DocType extends DocBase<FormatType>,
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
  FormatType extends FormatName,
  DocType extends DocBase<FormatType>,
> {
  // for a doc that was previously ingested, when a live query is catching up.
  kind: "existing";
  maxLocalIndex: number;
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
  maxLocalIndex: number;
}
export interface ReplicaEventDidClose {
  kind: "didClose";
}

export interface QueryFollowerDidClose {
  kind: "queryFollowerDidClose";
}

export interface IdleEvent {
  kind: "idle";
}

export interface ExpireEvent {
  kind: "expire";
  path: string;
}

/**
 * - IngestEventSuccess — a new doc was written
 * - IngestEventFailure — refused an invalid doc
 * - IngestEventNothingHappened — ingested an obsolete or duplicate doc
 */
export type IngestEvent<
  FormatType extends FormatName,
  DocType extends DocBase<FormatType>,
> =
  | IngestEventFailure
  | IngestEventNothingHappened<FormatType, DocType>
  | IngestEventSuccess<FormatType, DocType>;

/**
 * - DocAlreadyExists — processing an old doc as you catch up
 * - IdleEvent — reached the end of existing docs; waiting for new docs
 * - IngestEvent — the result of a replica ingesting a document
 * - ReplicaEventWillClose — the replica is about to close
 * - ReplicaEventDidClose — the replica has closed
 * - QueryFollowerDidClose — the query follower was closed (can happen on its own or after the replica closes)
 */
export type LiveQueryEvent<
  FormatType extends FormatName,
  DocType extends DocBase<FormatType>,
> =
  | DocAlreadyExists<FormatType, DocType>
  | // catching up...
  IdleEvent
  | // waiting for an ingest to happen...
  IngestEvent<FormatType, DocType>
  | // an ingest happened
  ExpireEvent
  | ReplicaEventWillClose
  | ReplicaEventDidClose
  | QueryFollowerDidClose;

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
 * A replica of a share's data, used to read, write, and synchronise data to.
 * Should be closed using the `close` method when no longer being used.
 * ```
 * const myReplica = new Replica("+a.a123", Es4Validatior, new ReplicaDriverMemory());
 * ```
 */
export interface IReplica<
  FormatType extends FormatName,
  DocInputType extends DocInputBase<FormatType>,
  DocType extends DocBase<FormatType>,
  ValidatorType extends IFormatValidator<
    FormatType,
    DocInputType,
    DocType
  >,
> extends IReplicaConfig {
  replicaId: ReplicaId;
  /** The address of the share this replica belongs to. */
  share: ShareAddress;
  /** The validators used to validate ingested documents. */
  formatValidators: Record<FormatType, ValidatorType>;
  replicaDriver: IReplicaDriver<
    FormatType,
    DocInputType,
    DocType,
    ValidatorType
  >;
  bus: Superbus<ReplicaBusChannel>;

  //--------------------------------------------------
  // LIFECYCLE

  /** Returns whether the replica is closed or not. */
  isClosed(): boolean;

  /**
   * Closes the replica, preventing new documents from being ingested or events being emitted.
   * Any methods called after closing will return `ReplicaIsClosedError`.
   * @param erase - Erase the contents of the replica. Defaults to `false`.
   */
  /*
  More details:

  * send ReplicaWillClose events and wait for event receivers to finish blocking.
  * close the IReplica
  * close the IReplicaDriver and possibly erase it
  * send ReplicaDidClose events and do not wait for event receivers.

  Any function called after the replica is closed will throw a ReplicaIsClosedError, except isClosed() is always allowed.

  You cannot call close() if the replica is already closed (it will throw a ReplicaIsClosedError).

  close() can happen while set() or ingest() are waiting for locks or have pending transactions.
  In that case, the pending operations will fail and throw a ReplicaIsClosed.

  If erase is true, actually delete and forget the local data (remove files, etc).
  Erase defaults to false if not provided.
  */
  close(erase: boolean): Promise<void>;

  //--------------------------------------------------
  // GET

  // this one is synchronous
  /** Returns the max local index of all stored documents */
  getMaxLocalIndex(): number;

  // these should all return frozen docs
  getDocsAfterLocalIndex(
    historyMode: HistoryMode,
    startAfter: LocalIndex,
    limit?: number,
  ): Promise<ExtractDocType<ValidatorType>[]>;
  /** Returns all documents, including historical versions of documents by other identities. */
  getAllDocs(): Promise<ExtractDocType<ValidatorType>[]>;
  /** Returns latest document from every path. */
  getLatestDocs(): Promise<ExtractDocType<ValidatorType>[]>;
  /** Returns all versions of a document by different authors from a specific path. */
  getAllDocsAtPath(path: Path): Promise<ExtractDocType<ValidatorType>[]>;
  /** Returns the most recently written version of a document at a path. */
  getLatestDocAtPath(
    path: Path,
  ): Promise<ExtractDocType<ValidatorType> | undefined>;

  /** Returns an array of docs for a given query.
  ```
  const myQuery = {
    filter: {
      pathEndsWith: ".txt"
    },
    limit: 5,
  };

  const firstFiveTextDocs = await myReplica.queryDocs(myQuery);
  ```
  */
  queryDocs(query?: Query): Promise<ExtractDocType<ValidatorType>[]>;

  /** Returns an array of all unique paths of documents returned by a given query. */
  queryPaths(query?: Query): Promise<Path[]>;

  /** Returns an array of all unique authors of documents returned by a given query. */
  queryAuthors(query?: Query): Promise<AuthorAddress[]>;

  //--------------------------------------------------
  // SET

  /**
   * Adds a new document to the replica. If a document signed by the same identity exists at the same path, it will be overwritten.
   */
  set<
    InputType extends ExtractInputType<ValidatorType>,
    OutputType extends ExtractDocType<
      ExtractValidatorWithFormat<ValidatorType, InputType["format"]>
    >,
  >(
    keypair: AuthorKeypair,
    docToSet: InputType,
  ): Promise<
    IngestEvent<
      FormatType,
      OutputType
    >
  >;

  /**
   * Ingest an existing signed document to the replica.
   */
  // this should freeze the incoming doc if needed
  ingest<
    DocType extends ExtractDocType<ValidatorType>,
    IngestType extends IngestEvent<
      DocType["format"],
      DocType
    >,
  >(
    docToIngest: DocType,
  ): Promise<
    IngestType
  >;

  /**
   * Overwrite every document from this author, including history versions, with an empty doc.
   */
  // More:
  // The new docs will have a timestamp of (oldDoc.timestamp + 1) to prevent them from
  //  jumping to the front of the history and becoming Latest.
  // Return the number of docs changed, or a ValidationError.
  // Already-empty docs will not be overwritten.
  // If an error occurs this will stop early.
  overwriteAllDocsByAuthor(
    keypair: AuthorKeypair,
  ): Promise<number | ValidationError>;
}

/**


/**
 * A replica driver provides low-level access to actual replica and is used by IReplica to actually load and save data. ReplicaDrivers are not meant to be used directly by users; let the Replica talk to it for you.
 */
export interface IReplicaDriver<
  FormatType extends FormatName,
  DocInputType extends DocInputBase<FormatType>,
  DocType extends DocBase<FormatType>,
  ValidatorType extends IFormatValidator<
    FormatType,
    DocInputType,
    DocType
  >,
> extends IReplicaConfig {
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
  queryDocs(query: Query): Promise<ExtractDocType<ValidatorType>[]>;
  //    queryPaths(query: Query): Doc[];
  // TODO: add a special getAllDocsAtPath for use by ingest?

  //--------------------------------------------------
  // SET

  /** Add or update a signed document. */
  // do no checks of any kind, just save it to the indexes
  // add a doc.  don't enforce any rules on it.
  // overwrite existing doc even if this doc is older.
  // return a copy of the doc, frozen, with _localIndex set.
  upsert<DocType extends ExtractDocType<ValidatorType>>(
    doc: DocType,
  ): Promise<DocType>;

  /** Erase all expired docs from the replica permanently, leaving no trace of the documents. Returns the paths of the expired documents. */
  eraseExpiredDocs(): Promise<Path[]>;
}

/** Options for configuring a new replica.
 * - `validators`: Validators for the kinds of documents this replica will replicate, e.g. FormatValidatorEs4.
 * - `driver`: A driver the replica will use to read and persist documents.
 */
export interface ReplicaOpts<
  FormatType extends FormatName,
  DocInputType extends DocInputBase<FormatType>,
  DocType extends DocBase<FormatType>,
  ValidatorType extends IFormatValidator<
    FormatType,
    DocInputType,
    DocType
  >,
> {
  validators: ValidatorType[];
  driver: IReplicaDriver<
    FormatType,
    DocInputType,
    DocType,
    ValidatorType
  >;
}

export type ReplicaForValidator<ValidatorType> = ValidatorType extends
  IFormatValidator<
    infer FormatType,
    infer DocInputType,
    infer DocType
  > ? IReplica<FormatType, DocInputType, DocType, ValidatorType>
  : never;

export type DriverForValidator<ValidatorType> = ValidatorType extends
  IFormatValidator<
    infer FormatType,
    infer DocInputType,
    infer DocType
  > ? IReplicaDriver<FormatType, DocInputType, DocType, ValidatorType>
  : never;
