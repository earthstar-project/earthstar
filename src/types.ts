
export type Thunk = () => void;
export type Callback<T> = (data: T) => void;
export type AsyncCallback<T> = (data: T) => Promise<void>;

export type AuthorAddress = string;
export type WorkspaceAddress = string;
export type Path = string;
export type Signature = string;
export type Timestamp = number;
export type LocalIndex = number;

export interface AuthorKeypair {
    address: AuthorAddress,
    secret: string,
}

//================================================================================ 
// DOCUMENTS

export interface Doc {
    // TODO: format
    workspace: WorkspaceAddress,
    path: Path,
    author: AuthorAddress,
    content: string,
    contentHash: string,
    contentLength: number,
    timestamp: Timestamp,
    signature: Signature,

    // Local Index:
    // Our docs form a linear sequence with gaps.
    // When a doc is updated (same author, same path, new content), it moves to the
    // end of the sequence and gets a new, higher localIndex.
    // This sequence is specific to this local storage, affected by the order it received
    // documents.
    //
    // It's useful during syncing so that other peers can say "give me everything that's
    // changed since your localIndex 23".
    //
    // This is sent over the wire as part of a Doc so the receiver knows what to ask for next time,
    // but it's then moved into a separate data structure like:
    //    knownPeerHighestLocalIndexes:
    //        peer111: 77
    //        peer222: 140
    // ...which helps us continue syncing with that specific peer next time.
    //
    // When we upsert the doc into our own storage, we discard the other peer's value
    // and replace it with our own localIndex.
    //
    // The localIndex is not included in the doc's signature.
    _localIndex?: LocalIndex,
}

// A partial doc that is about to get written.
// The rest of the properties will be filled in by storage.write().
export interface DocToWrite {
    workspace: WorkspaceAddress,
    path: Path,
    author: AuthorAddress,
    content: string,
}

//================================================================================ 
// EVENTS AND FOLLOWERS

export enum UpsertResult {
    // doc was not saved: negative numbers
    Obsolete = -3,
    AlreadyHadIt = -2,
    Invalid = -1,

    // doc was saved: positive numbers
    AcceptedButNotLatest = 1,
    AcceptedAndLatest = 2,
}

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

export interface Follower {
    // A Follower is a callback that progresses along the LocalIndex of documents

    cb: Callback<Doc> | AsyncCallback<Doc>;

    // The next doc to process.  This should start at zero.
    nextIndex: LocalIndex;

    // Sync followers are synchronous functions.
    // - they block addFollower until they are all caught up.
    // - they block upsert until they have run. 
    //
    // Async followers are async functions.
    // - addFollower does not block
    // - they move along lazily at their own pace along the LocalIndex
    //    until they hit the end, then they go to sleep
    // - they wake up when new docs are upserted
    // - upsert does not wait for these followers to finish
    // - TODO: need another callback or special event so an async follower
    //    can know when it's caught up
    kind: 'sync' | 'async';

    // state, mostly used for async followers
    state?: 'running' | 'sleeping' | 'quitting',
}

//================================================================================ 
// QUERY

// ways to filter an individual document with no other context
export interface QueryFilter {
    path?: Path,
    pathStartsWith?: string,
    pathEndsWith?: string,
    author?: AuthorAddress,
    timestamp?: Timestamp,
    timestampGt?: Timestamp,
    timestampLt?: Timestamp,
    contentLength?: number,
    contentLengthGt?: number,
    contentLengthLt?: number,
}

export interface Query {
    // for each property, the first option is the default if it's omitted

    // this is in the order that processing happens:

    // first, limit to latest docs or all docs
    history?: 'latest' | 'all',

    // then iterate in this order
    //   "path ASC" is actually "path ASC then break ties with timestamp DESC"
    //   "path DESC" is the reverse of that
    orderBy?: 'path ASC' | 'path DESC' | 'localIndex ASC' | 'localIndex DESC';

    // start iterating at this item
    startAt?: {
        // only when ordering by localIndex
        localIndex?: number,
        // only when ordering by path
        path?: string,
    }

    // then apply filters, if any
    filter?: QueryFilter,

    // stop iterating after this number of docs
    limit?: number;
    // TODO: limitBytes
}

export let DEFAULT_QUERY: Query = {
    history: 'latest',
    orderBy: 'path ASC',
    startAt: undefined,
    limit: undefined,
    filter: undefined,
}

//================================================================================ 

export interface IStorage {
    // The max local index used so far.  the first doc will increment this and get index 1.
    highestLocalIndex: LocalIndex;

    //--------------------------------------------------
    // CALLBACKS AND FOLLOWERS

    onWrite(cb: Callback<WriteEvent>): Thunk;
    addFollower(follower: Follower): Thunk;
    getDocsSinceLocalIndex(startAt: LocalIndex, limit?: number): Doc[];

    //--------------------------------------------------
    // GET

    getAllDocs(sort: boolean): Doc[];
    getLatestDocs(sort: boolean): Doc[];
    getAllDocsAtPath(path: Path): Doc[] | undefined;
    getLatestDocAtPath(path: Path): Doc | undefined;
    queryDocs(query?: Query): Doc[];
    queryPaths(query?: Query): Path[];
    queryAuthors(query?: Query): AuthorAddress[];

    //--------------------------------------------------
    // SET

    write(keypair: AuthorKeypair, docToWrite: DocToWrite): UpsertResult;
    upsert(doc: Doc): UpsertResult;
};

