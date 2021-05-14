import {
    Superbus
} from 'superbus';

import {
    AuthorKeypair,
    Doc,
    DocToSet,
    LocalIndex,
    Path,
    WorkspaceAddress,
} from '../util/doc-types';
import {
    HistoryMode,
    Query,
} from '../query/query-types';
import {
    IFormatValidator
} from '../format-validators/format-validator-types';
import {
    ValidationError
} from '../util/errors';

import {
    Lock,
} from './lock';

//================================================================================

export type StorageId = string;

export type StorageEvent =
    'ingest' |  // 'ingest|/some/path.txt'
    'willClose' | 'didClose';

export interface IStorageAsyncConfig {
    // This is for local storage of configuration details for storage instances.
    // This data will not be directly sync'd with other instances.
    // Storage drivers implement these, and IStorageAsync just has stubs of
    // these methods that call out to the storage driver.
    getConfig(key: string): Promise<string | undefined>;
    setConfig(key: string, value: string): Promise<void>;
    listConfigKeys(): Promise<string[]>;  // sorted
    deleteConfig(key: string): Promise<boolean>;
}

export interface IStorageAsync extends IStorageAsyncConfig {
    storageId: StorageId;
    workspace: WorkspaceAddress;
    formatValidator: IFormatValidator;
    storageDriver: IStorageDriverAsync;
    bus: Superbus<StorageEvent>;

    //--------------------------------------------------
    // LIFECYCLE

    isClosed(): boolean;
    /**
     * close()
     *   * send StorageWillClose events and wait for event receivers to finish blocking.
     *   * close the IStorage
     *   * close the IStorageDriver
     *   * send StorageDidClose events and do not wait for event receivers.
     * 
     * Any function called after the storage is closed will throw a StorageIsClosedError,
     *  except isClosed() is always allowed, and close() can be called multiple times.
     * 
     * close() can happen while set() or ingest() are waiting for locks or have pending transactions.
     * In that case, the pending operations will fail and throw a storageIsClosed.
     */
    close(): Promise<void>;

    //--------------------------------------------------
    // GET

    // this one is synchronous
    getMaxLocalIndex(): number;

    // these should all return frozen docs
    getDocsAfterLocalIndex(historyMode: HistoryMode, startAfter: LocalIndex, limit?: number): Promise<Doc[]>;
    getAllDocs(): Promise<Doc[]>;
    getLatestDocs(): Promise<Doc[]>;
    getAllDocsAtPath(path: Path): Promise<Doc[]>;
    getLatestDocAtPath(path: Path): Promise<Doc | undefined>;

    queryDocs(query?: Query): Promise<Doc[]>;
//    queryPaths(query?: Query): Path[];
//    queryAuthors(query?: Query): AuthorAddress[];

    //--------------------------------------------------
    // SET

    set(keypair: AuthorKeypair, doc: DocToSet): Promise<IngestResultAndDoc>;

    // this should freeze the incoming doc if needed
    ingest(doc: Doc): Promise<IngestResultAndDoc>;

    // Overwrite every doc from this author, including history versions, with an empty doc.
    // The new docs will have a timestamp of (oldDoc.timestamp + 1) to prevent them from
    //  jumping to the front of the history and becoming Latest.
    // Return the number of docs changed, or a ValidationError.
    // Already-empty docs will not be overwritten.
    // If an error occurs this will stop early.
    overwriteAllDocsByAuthor(keypair: AuthorKeypair): Promise<number | ValidationError>;
}

export interface IStorageDriverAsync extends IStorageAsyncConfig {
    workspace: WorkspaceAddress;
    lock: Lock<any>;

    //--------------------------------------------------
    // LIFECYCLE

    // TODO: hatch (and load maxLocalIndex)

    isClosed(): boolean;
    // the IStorage will call this
    close(): Promise<void>;

    //--------------------------------------------------
    // GET

    // The max local index used so far.
    // The first doc will increment this and get index 1.
    // This is synchronous because it's expected that the driver will
    // load it once at startup and then keep it in memory.
    getMaxLocalIndex(): number;

    // this should return frozen docs
    queryDocs(query: Query): Promise<Doc[]>;
//    queryPaths(query: Query): Doc[];

    //--------------------------------------------------
    // SET
    // do no checks of any kind, just save it to the indexes
    // add a doc.  don't enforce any rules on it.
    // overwrite existing doc even if this doc is older.
    // return a copy of the doc, frozen, with _localIndex set.
    upsert(doc: Doc): Promise<Doc>;
}

//================================================================================ 
// EVENTS

export enum IngestResult {
    // doc was not saved: negative numbers
    WriteError = 'WRITE_ERROR',
    ObsoleteFromSameAuthor = 'OBSOLETE_FROM_SAME_AUTHOR',
    AlreadyHadIt = 'ALREADY_HAD_IT',
    Invalid = 'INVALID_DOCUMENT',

    // doc was saved: positive numbers
    AcceptedButNotLatest = 'ACCEPTED_BUT_NOT_LATEST',
    AcceptedAndLatest = 'ACCEPTED_AND_LATEST',
}

export interface IngestResultAndDoc {
    ingestResult: IngestResult,
    docIngested: Doc | null,
}

/*
export interface WriteEvent {
    // This is only sent on a successful write.
    doc: Doc,

    // Is this doc the latest one at its path (for any author)?
    isLatest: boolean,

    // Prev doc from the same author at this path, if there was one.
    // This may be present no matter the value of isLatest.
    previousDocSameAuthor: Doc | undefined;

    // If this doc isLatest, what was the previous latest doc until just now?
    // It can be from the same author or a different one.
    previousLatestDoc: Doc | undefined;
}
*/