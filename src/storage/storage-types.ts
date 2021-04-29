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
} from './query-types';
import {
    IFormatValidator
} from '../format-validators/format-validator-types';

import {
    Lock,
} from './lock';

//================================================================================

export type StorageEvent =
    'ingest' |
    'willClose' | 'didClose';

export interface IStorageAsync {
    workspace: WorkspaceAddress;
    formatValidator: IFormatValidator;
    storageDriver: IStorageDriverAsync;
    bus: Superbus<StorageEvent>;

    //--------------------------------------------------
    // GET

    // these should all return frozen docs
    getDocsSinceLocalIndex(historyMode: HistoryMode, startAt: LocalIndex, limit?: number): Promise<Doc[]>;
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
}

export interface IStorageDriverAsync {
    workspace: WorkspaceAddress;
    lock: Lock;
    // The max local index used so far.  the first doc will increment this and get index 1.
    //highestLocalIndex: LocalIndex;
    getHighestLocalIndex(): number;

    //--------------------------------------------------
    // GET
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

    isClosed(): boolean;
    // the IStorage will call this
    close(): Promise<void>;
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