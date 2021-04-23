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

export type FollowerState = 'running' | 'sleeping' | 'closed';
export interface IFollower {
    blocking: boolean;
    wake(): Promise<void>;
    hatch(): Promise<void>;
    close(): void;
}

export interface IStorageAsync {
    workspace: WorkspaceAddress;
    formatValidator: IFormatValidator;
    storageDriver: IStorageDriverAsync;

    //--------------------------------------------------
    // CALLBACKS AND FOLLOWERS

    // TODO: does this belong on the main storage or the driver?
    _followers: Set<IFollower>;

    getDocsSinceLocalIndex(historyMode: HistoryMode, startAt: LocalIndex, limit?: number): Promise<Doc[]>;
    //--------------------------------------------------
    // GET

    // these should all return frozen docs
    getAllDocs(): Promise<Doc[]>;
    getLatestDocs(): Promise<Doc[]>;
    getAllDocsAtPath(path: Path): Promise<Doc[]>;
    getLatestDocAtPath(path: Path): Promise<Doc | undefined>;

    queryDocs(query?: Query): Promise<Doc[]>;
//    queryPaths(query?: Query): Path[];
//    queryAuthors(query?: Query): AuthorAddress[];

    //--------------------------------------------------
    // SET
    set(keypair: AuthorKeypair, doc: DocToSet): Promise<IngestResult>;

    // this should freeze the incoming doc if needed
    ingest(doc: Doc): Promise<IngestResult>;
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
    // this should freeze the doc if needed
    upsert(doc: Doc): Promise<boolean>;
}

//================================================================================ 
// EVENTS AND FOLLOWERS

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