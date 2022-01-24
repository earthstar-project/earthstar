import {
    AuthorKeypair,
    Doc,
    DocToSet,
    LocalIndex,
    Path,
    WorkspaceAddress,
} from "../util/doc-types.ts";
import { HistoryMode, Query } from "../query/query-types.ts";
import { IFormatValidator } from "../format-validators/format-validator-types.ts";
import { ValidationError } from "../util/errors.ts";
import { Thunk } from "./util-types.ts";
import { Superbus } from "../../deps.ts";

//================================================================================
// TYPES AND EVENTS

export type StorageId = string;

export type StorageBusChannel =
    | "ingest"
    | // 'write|/some/path.txt'  // note that write errors and no-ops are also sent here
    "willClose"
    | "didClose";

export interface QueryResult {
    // the docs from the query...
    docs: Doc[];
    // ...and the storageDriver's maxLocalIndex at the time
    // just before and just after the query was done.
    // This provided a lower and upper bound for the maxLocalIndex
    // associated with the resulting docs.
    // (This is the OVERALL max local index for
    // the whole storage, not just for the resulting docs.)
    maxLocalIndexBefore: number;
    maxLocalIndexAfter: number;
    // The max localIndex out of the returned docs.
    // This could be much smaller than the overall maxLocalIndex
    // if the docs have been filtered.
    // If there are no matching docs, this is -1.
    maxLocalIndexInResult: number;
}

// IngestEvents are returned from storage.set() and storage.ingest(),
// and sent as events on the storage.bus 'ingest' channel.

export interface IngestEventFailure {
    kind: "failure";
    reason: "write_error" | "invalid_document";
    maxLocalIndex: number;
    err: Error | null;
}
export interface IngestEventNothingHappened {
    kind: "nothing_happened";
    reason: "obsolete_from_same_author" | "already_had_it";
    maxLocalIndex: number;
    doc: Doc; // won't have a _localIndex because it was not actually ingested
}
export interface IngestEventSuccess {
    kind: "success";
    maxLocalIndex: number;
    doc: Doc; // the just-written doc, frozen, with updated extra properties like _localIndex

    docIsLatest: boolean; // is it the latest at this path (for any author)?

    // the most recent doc from the same author, at this path, before the new doc was written.
    prevDocFromSameAuthor: Doc | null;

    // the latest doc from any author at this path, before the new doc was written.
    // note this is actually still the latest doc if the just-written doc is an older one (docIsLatest===false)
    prevLatestDoc: Doc | null;
}
export interface DocAlreadyExists {
    // for a doc that was previously ingested, when a live query is catching up.
    kind: "existing";
    maxLocalIndex: number;
    doc: Doc; // the just-written doc, frozen, with updated extra properties like _localIndex

    //docIsLatest: boolean,  // is it the latest at this path (for any author)?

    //// the most recent doc from the same author, at this path, before the new doc was written.
    //prevDocFromSameAuthor: Doc | null,

    //// the latest doc from any author at this path, before the new doc was written.
    //// note this is actually still the latest doc if the just-written doc is an older one (docIsLatest===false)
    //prevLatestDoc: Doc | null,
}
export interface StorageEventWillClose {
    kind: "willClose";
    maxLocalIndex: number;
}
export interface StorageEventDidClose {
    kind: "didClose";
}

export interface QueryFollowerDidClose {
    kind: "queryFollowerDidClose";
}

export interface IdleEvent {
    kind: "idle";
}

export type IngestEvent =
    | IngestEventFailure
    | IngestEventNothingHappened
    | IngestEventSuccess;

export type LiveQueryEvent =
    | DocAlreadyExists
    | // catching up...
    IdleEvent
    | // waiting for an ingest to happen...
    IngestEvent
    | // an ingest happened
    StorageEventWillClose
    | StorageEventDidClose
    | QueryFollowerDidClose;

//================================================================================

export interface IStorageAsyncConfigStorage {
    // These methods will be mixed into the IStorageAsync.
    // This is for local storage of configuration details for storage instances.
    // This data will not be directly sync'd with other instances.
    // Storage drivers implement these, and IStorageAsync just has stubs of
    // these methods that call out to the storage driver.
    getConfig(key: string): Promise<string | undefined>;
    setConfig(key: string, value: string): Promise<void>;
    listConfigKeys(): Promise<string[]>; // sorted
    deleteConfig(key: string): Promise<boolean>;
}

/**
 * A replica of a share's data, used to read, write, and synchronise data to.
 * Should be closed using the `close` method when no longer being used.
 * ```
 * const myReplica = new StorageAsync("+a.a123", Es4Validatior, new StorageDriverMemory());
 * ```
 */
export interface IStorageAsync extends IStorageAsyncConfigStorage {
    storageId: StorageId;
    /** The address of the share this replica belongs to. */
    workspace: WorkspaceAddress;
    /** The validator used to validate ingested documents. */
    formatValidator: IFormatValidator;
    storageDriver: IStorageDriverAsync;
    bus: Superbus<StorageBusChannel>;

    //--------------------------------------------------
    // LIFECYCLE

    /** Returns whether the storage is closed or not. */
    isClosed(): boolean;

    /**
     * Closes the replica, preventing new documents from being ingested or events being emitted.
     * Any methods called after closing will return `StorageIsClosedError`.
     * @param erase - Erase the contents of the replica. Defaults to `false`.
     */
    /*
  More details:

  * send StorageWillClose events and wait for event receivers to finish blocking.
  * close the IStorage
  * close the IStorageDriver and possibly erase it
  * send StorageDidClose events and do not wait for event receivers.

  Any function called after the storage is closed will throw a StorageIsClosedError, except isClosed() is always allowed.

  You cannot call close() if the storage is already closed (it will throw a StorageIsClosedError).

  close() can happen while set() or ingest() are waiting for locks or have pending transactions.
  In that case, the pending operations will fail and throw a storageIsClosed.

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
    ): Promise<Doc[]>;
    /** Returns all documents, including historical versions of documents by other identities. */
    getAllDocs(): Promise<Doc[]>;
    /** Returns latest document from every path. */
    getLatestDocs(): Promise<Doc[]>;
    /** Returns all versions of a document by different authors from a specific path. */
    getAllDocsAtPath(path: Path): Promise<Doc[]>;
    /** Returns the most recently written version of a document at a path. */
    getLatestDocAtPath(path: Path): Promise<Doc | undefined>;

    /** Returns a collection of docs for a given query.
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
    queryDocs(query?: Query): Promise<Doc[]>;

    //    queryPaths(query?: Query): Path[];
    //    queryAuthors(query?: Query): AuthorAddress[];

    //--------------------------------------------------
    // SET

    /**
     * Adds a new document to the replica. If an document signed by the same identity exists at the same path, it will be overwritten.
     */
    set(keypair: AuthorKeypair, docToSet: DocToSet): Promise<IngestEvent>;

    /**
     * Ingest an existing signed document to the replica.
     */
    // this should freeze the incoming doc if needed
    ingest(doc: Doc): Promise<IngestEvent>;

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
 * A storageDriver provides low-level access to actual storage and is used by
 * IStorageAsync to actually load and save data.
 * StorageDrivers are not meant to be used directly by users; let the IStorageAsync
 * talk to it for you.
 */
export interface IStorageDriverAsync extends IStorageAsyncConfigStorage {
    workspace: WorkspaceAddress;

    //--------------------------------------------------
    // LIFECYCLE

    // TODO: hatch (and load maxLocalIndex)

    isClosed(): boolean;
    /**
     * Close the storageDriver.
     * The Storage will call this.
     * You cannot call close() if the storage is already closed (it will throw a StorageIsClosedError).
     * If erase, actually delete and forget data locally.
     * Erase defaults to false if not provided.
     */
    close(erase: boolean): Promise<void>;

    //--------------------------------------------------
    // GET

    // The max local index used so far.
    // The first doc will increment this and get index 1.
    // This is synchronous because it's expected that the driver will
    // load it once at startup and then keep it in memory.
    getMaxLocalIndex(): number;

    // these should return frozen docs
    queryDocs(query: Query): Promise<Doc[]>;
    //    queryPaths(query: Query): Doc[];

    // TODO: add a special getAllDocsAtPath for use by ingest?

    //--------------------------------------------------
    // SET
    // do no checks of any kind, just save it to the indexes
    // add a doc.  don't enforce any rules on it.
    // overwrite existing doc even if this doc is older.
    // return a copy of the doc, frozen, with _localIndex set.
    upsert(doc: Doc): Promise<Doc>;
}
