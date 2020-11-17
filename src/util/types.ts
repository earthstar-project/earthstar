import { Emitter } from './emitter';

//================================================================================
// BASIC HELPER TYPES

export type Thunk = () => void;

//================================================================================
// ERRORS

/**
 * The result of an attempt to write a document into an IStorage.
 */
export enum WriteResult {
    /** The document was successfully written. */
    Accepted = "ACCEPTED",
    /** The document was older than what the IStorage already had, or was not wanted by a sync query. */
    Ignored = "IGNORED",
}

/** Generic top-level error class that other Earthstar errors inherit from. */
export class EarthstarError extends Error {
    constructor(message?: string) {
        super(message || '');
        this.name = 'EarthstarError';
    }
}

/** Validation failed on a document, workspace address, author address, etc. */
export class ValidationError extends EarthstarError {
    constructor(message?: string) {
        super(message || 'Validation error');
        this.name = 'ValidationError';
    }
}

/** An IStorage instance was used after close() was called on it. */
export class StorageIsClosedError extends EarthstarError {
    constructor(message?: string) {
        super(message || 'a Storage instance was used after being closed');
        this.name = 'StorageIsClosedError';
    }
}
export class NotFoundError extends EarthstarError {
    constructor(message?: string) {
        super(message || 'not found');
        this.name = 'NotFoundError';
    }
}
/** A pub URL is bad or the network is down */
export class NetworkError extends EarthstarError {
    constructor(message?: string) {
        super(message || 'network error');
        this.name = 'NetworkError';
    }
}
export class TimeoutError extends EarthstarError {
    constructor(message?: string) {
        super(message || 'timeout error');
        this.name = 'TimeoutError';
    }
}
/** A pub won't accept writes */
export class ConnectionRefusedError extends EarthstarError {
    constructor(message?: string) {
        super(message || 'connection refused');
        this.name = 'ConnectionRefused';
    }
}
export class NotImplementedError extends EarthstarError {
    constructor(message?: string) {
        super(message || 'not implemented yet');
        this.name = 'NotImplementedError';
    }
}

/** Check if any value is a subclass of EarthstarError (return true) or not (return false) */
export let isErr = <T>(x: T | Error): x is EarthstarError =>
    x instanceof EarthstarError;

/** Check if any value is a subclass of EarthstarError (return false) or not (return true) */
export let notErr = <T>(x: T | Error): x is T =>
    !(x instanceof EarthstarError);

/**
 * Given an array of items, return the first one which is a subclass of EarthstarError.
 * If none are errors, return `otherwise`.
 */
export let firstError = <T, E extends EarthstarError>(items : Array<T | E>, otherwise: T) : T | E => {
    for (let item of items) {
        if (item instanceof EarthstarError) {
            return item;
        }
    }
    return otherwise;
}
export let firstErrorThunk = <T, E extends EarthstarError>(thunks : Array<() => T | E>, otherwise: T) : T | E => {
    for (let thunk of thunks) {
        let value = thunk();
        if (value instanceof EarthstarError) { return value; }
    }
    return otherwise;
}

/*
// Err is used throughout Earthstar to return errors from functions
export type Err = {
    err: string,
    [key:string]: any,
};
export let isErr = <T>(x : T | Err) : x is Err =>
    'err' in x;
export let notErr = <T>(x : T | Err) : x is T =>
    !isErr(x);
*/

//================================================================================
// DOCUMENT FIELDS

// some vocabulary:
//   WorkspaceAddress = '+' + WorkspaceName + '.' + (WorkspacePubkey | WorkspaceRandom)
//   AuthorAddress = '@' + AuthorShortname + '.' + AuthorPubkey

export type WorkspaceAddress = string;
export type WorkspaceName = string;

export type AuthorAddress = string;
export type AuthorShortname = string;

export type Base32String = string;

export type EncodedHash = Base32String;  // hashes are also base32
export type EncodedKey = Base32String;  // pubkey or secret key as base32
export type EncodedSig = Base32String;  // signature, as base32

export type AuthorParsed = {
    address: AuthorAddress,
    shortname: AuthorShortname,
    pubkey: EncodedKey,
};

export type WorkspaceParsed = {
    address: WorkspaceAddress,
    name: WorkspaceName,
    pubkey: EncodedKey,
};

export type AuthorKeypair = {
    address: AuthorAddress,
    secret: EncodedKey,
};

export type Path = string;

/** A document format such as "es.4". */
export type FormatName = string;

//================================================================================
// DOCUMENTS

/**
 * The main type for Earthstar documents.
 *
 * TODO: is this type specific to the es.4 format, or is it a universal requirement for all Earthstar formats?
 */
export type Document = {
    format: FormatName,
    workspace: WorkspaceAddress,
    path: Path,
    contentHash: EncodedHash,
    content: string,  // TODO: eventually, this should be "string | null"
    author: AuthorAddress,
    timestamp: number,
    deleteAfter: number | null,
    signature: EncodedSig,
};

/**
 * A more limited version of a Document, used by the Storage.set() method.
 * Omits properties that are provided separately or generated writing a new document --
 * workspace, author, and signature
 */
export type DocToSet = {
    format: FormatName,
    path: Path,
    content: string,
    /** Timestamp only for testing, usually omitted. */
    timestamp?: number,
    /** Deletion time for ephemeral documents.  Omit to default to null. */
    deleteAfter?: number | null,  // for ephemeral documents.  omit to get null

    // workspace is implied by the storage we put it into
    // no author - the whole keypair is provided separately when setting
    // no signature - it's generated during setting
};

//================================================================================

/**
 * Query objects describe how to query a Storage instance for documents.
 * 
 * An empty query object returns all documents.
 * Each of the following properties adds an additional filter,
 * narrowing down the results further.
 */
export interface QueryOpts {
    /** Match one specific path only. */
    path?: string,

    /** Paths starting with this string. */
    pathPrefix?: string,

    /** lowPath <= p */
    lowPath?: string,
    /** p < highPath */
    highPath?: string,

    /**
     * Only return the first N documents.
     * This counts the total number of docs returned, counting historical and most-recent versions.
     * There's no offset; use lowPath as a cursor instead
     */
    limit?: number,

    /** Include old versions of this doc from different authors?  Default `false`. */
    includeHistory?: boolean,

    /**
     * If including history, find paths where the author ever wrote, and return all history for those paths by anyone.
     *
     * If not including history, find paths where the author ever wrote, and return the latest doc (maybe not by the author).
     */
    participatingAuthor?: AuthorAddress,

    //// If including history, find paths with the given last-author, and return all history for those paths
    //// If not including history, find paths with the given last-author, and return just the last doc
    //lastAuthor?: AuthorAddress,

    /**
     * If including history, find any individual revision by this author (heads and non-heads).
     *
     * If not including history, it's any individual revision by this author which is also a head.
     */
    versionsByAuthor?: AuthorAddress,

    /**
     * If true, only match documents with content === "" (e.g. deleted documents)
     *
     * If false, only match documents with content.length >= 1
     * 
     * If omitted, match all documents.
     */
    contentIsEmpty?: boolean,

    // timestamp before and after // TODO

    // sort order: TODO
    // For now the default sort is path ASC, then timestamp DESC (newest first within same path)

    /**
     * The time at which the query is considered to take place.
     * This is useful for testing ephemeral document expiration.
     * Normally this should be omitted.  It defaults to the current time.
     */
    now?: number,
}

//================================================================================
// SYNCING

/** Options for the IStorage.sync() method */
export interface SyncOpts {
    direction?: 'push' | 'pull' | 'both',  // default both

    // Sync existing documents?  Defaults to true.
    // The only reason to turn this off is if you're setting live: true
    // and you only want the live stream of new documents, not existing ones.
    existing?: boolean,

    // Continue sync forever as a stream of newly changed documents?
    // Defaults to false.
    // (This is not implemented yet)
    // TODO: how to stop a live sync?
    live?: boolean,

    // If both existing==false and live==false, no documents will get synced at all.

    // TODO: add sync filters.
    // These limit the documents we send/receive during a sync.
    // If you supply an array, it will send/receive docs that match ANY of the queries (logical OR).
    // On the other hand setting multiple filters within one query acts like a logical AND.
    // This is deliberate - it allows you to construct more complex queries by combining the two techniques.
    //   incomingSyncFilters: QueryOpts | QueryOpts[],  // only accept matching docs
    //   outgoingSyncFilters: QueryOpts | QueryOpts[],  // only send matching docs
}

/** Stats about what happened in a sync. */
export interface SyncResults {
    // number of documents that the other side didn't already have, that they accepted from us
    numPushed: number,
    // number that we accepted from the other side
    numPulled: number,
}

//================================================================================

/**
 * Validators are each responsible for one document format such as "es.4".
 * They are used by Storage instances to
 * * check if documents are valid before accepting them
 * * sign new documents
 *
 * According to the rules of Earthstar: documents are validated statelessly,
 * one document at a time, without knowing about any other documents
 * or what's in the Storage.
 *
 * These are all static methods.
 * You won't be making instances of Validators because they have no state.
 * They're just a collection of functions.
 */
export interface IValidator {

    /** The string name of the format, like "es.4" */
    format: FormatName;

    // Deterministic hash of this version of the document */
    hashDocument(doc: Document): EncodedHash | ValidationError;

    /**
     * Add an author signature to the document.
     * The input document needs a signature field to satisfy Typescript, but
     * it will be overwritten here, so you may as well just set signature: '' on the input.
     */
    signDocument(keypair: AuthorKeypair, doc: Document): Document | ValidationError;

    /**
     * This calls all the more detailed functions which start with underscores.
     * Returns true if the document is ok.
     */
    checkDocumentIsValid(doc: Document, now?: number): true | ValidationError;

    // These are broken out for easier unit testing.
    // They will not normally be used directly; use the main assertDocumentIsValid instead.
    // Return true on success.
    _checkBasicDocumentValidity(doc: Document): true | ValidationError;  // check for correct fields and datatypes
    _checkAuthorCanWriteToPath(author: AuthorAddress, path: Path): true | ValidationError;
    _checkTimestampIsOk(timestamp: number, deleteAfter: number | null, now: number): true | ValidationError;
    _checkPathIsValid(path: Path, deleteAfter?: number | null): true | ValidationError;
    _checkAuthorIsValid(authorAddress: AuthorAddress): true | ValidationError;
    _checkWorkspaceIsValid(workspaceAddress: WorkspaceAddress): true | ValidationError;
    _checkAuthorSignatureIsValid(doc: Document): true | ValidationError;
    _checkContentMatchesHash(content: string, contentHash: EncodedHash): true | ValidationError;

    /** Parse an author address into its parts. */
    parseAuthorAddress(addr : AuthorAddress) : AuthorParsed | ValidationError;

    /** Parse a workspace address into its parts. */
    parseWorkspaceAddress(addr : WorkspaceAddress) : WorkspaceParsed | ValidationError;

    // TODO: add these methods for building addresses
    // and remove them from crypto.ts and encoding.ts
    // assembleWorkspaceAddress = (name : WorkspaceName, encodedPubkey : EncodedKey) : WorkspaceAddress
    // assembleAuthorAddress = (shortname : AuthorShortname, encodedPubkey : EncodedKey) : AuthorAddress
}

/** A validator for format "es.4" */
export interface IValidatorES4 extends IValidator {
    format: 'es.4';
}

//================================================================================

/**
 * The event your callback gets when you subscribe to IStorage.onWrite.subscribe(callback).
 */
export type WriteEvent = {
    kind: 'DOCUMENT_WRITE',
    /**
     * A write is "local" if it comes from IStorage.set(),
     * otherwise it's "remote" (it came from a sync).
     */
    isLocal: boolean,
    /**
     * A write is "latest" if it's the one that will come back from a getDocument(path) call.
     * e.g. it's the history document for that path with the highest timestamp.
     * If it's not "latest", it's a history document.
     */
    isLatest: boolean,
    /** The new version of the document that was written. */
    document: Document,
}

/**
 * A IStorage instance holds the documents of a single workspace
 * in some kind of local storage (memory, a database, etc).
 *
 * To construct an IStorage, you need to supply
 *   * a workspace address
 *   * a list of Validator classes, for the document formats you want to support
 *   * various other options such as database filenames, specific to that kind of Storage
 *
 * Immutability:
 *   Document objects should be treated as immutable and never mutated.
 *   This applies to
 *   * objects you pass into IStorage (to ingestDocument)
 *   * objects you get from IStorage (from getDocument, etc).
 *   The IStorage instance may call Object.freeze() on document objects in both
 *   of the above cases, to enforce this.
 */
export interface IStorage {

    /** The workspace address held in this Storage object. */
    workspace: WorkspaceAddress;

    /**
     * onWrite is called whenever any data changes:
     *   * after every set()
     *   * after every ingestDocument()
     *   * after each document obtained during a sync (because that happens via ingestDocument())
     * Subscribe with onWrite.subscribe(...cb...);
     * 
     * Your callback will be given a WriteEvent.
     */
    onWrite: Emitter<WriteEvent>;
    /**
     * onChange is deprecated.  It's called in the same situations as onWrite but it's missing the WriteEvent information.
     * @deprecated
     */
    onChange: Emitter<undefined>;

    // QUERYING
    /**
     * Return the documents that match the query.
     * Default sort is path ASC, then timestamp DESC (newest first within same path)
     *  but query objects will eventually include sort options.
     */
    documents(query?: QueryOpts): Document[];
    /** Same as documents(), but only return the distinct paths of the matching documents (duplicates removed). */
    paths(query?: QueryOpts): string[];
    /** Same as documents(), but only return the content properties of the matching documents. */
    contents(query?: QueryOpts): string[];

    /** List of authors that have ever written in this workspace. */
    authors(now?: number): AuthorAddress[];

    // INDIVIDUAL DOCUMENT LOOKUP
    /**
     * Get one document by path.
     * Only returns the most recent document at this path.
     * To get older docs at this path (from other authors), do a query.
     */
    getDocument(path: string, now?: number): Document | undefined;
    /** Same as getDocument(path).content -- just returns the content of the most recent document */
    getContent(path: string, now?: number): string | undefined;

    // WRITING
    /**
     * Write or overwrite a document.
     * 
     * You will need an author's private key which is part of the keypair object.
     * 
     * Provide a DocToSet which is is similar but smaller than a regular document:
     * ``` 
     * {
     *   format: which document format to use
     *   path
     *   content
     *   timestamp: optional.  If absent or zero, it will be set to the current time
     *   - no workspace -- this Storage object knows what workspace it is
     *   - no author -- it's provided in the keypair argument
     *   - no signature -- it will be signed for you
     * }
     * ```
     * Timestamps should only be set manually for testing purposes.  Normally they should be
     * omitted so they default to the current time.
     * If the timestamp is omitted or zero, it will be actually set to
     *  `max(current time, highest existing timestamp in this path)`
     * so that this set() operation will be the winning, latest document in the path.
     * If the timestamp is supplied, it will not be bumped ahead in this way.
     *
     * `now` should usually be omitted; it's used for testing and defaults to `Date.now()*1000`.
     * If affects the default timestamp chosen for the document, and is used when deciding if
     * ephemeral documents are expired or not.
     */
    set(keypair: AuthorKeypair, docToSet: DocToSet, now?: number): WriteResult | ValidationError;

    /**
     * Save a document from an external source to this Storage instance.
     * The document must be already signed.
     * This is used when obtaining documents from the outside world, e.g. syncing.
     * The document will be validated before being stored.
     *
     * @param now Should usually be omitted; it's used for testing and defaults to Date.now()*1000
     * @param isLocal Is used internally to track if this came from a set() operation or not.
     *   Set it true if the document was written because of a local user action;
     *   set it false if it was obtained from the outside world.
     */
    ingestDocument(doc: Document, now?: number, isLocal?: boolean): WriteResult | ValidationError;

    /** Internal helper method to do a one-way pull sync. */
    _syncFrom(otherStore: IStorage, existing: boolean, live: boolean): number;

    // TODO: add now? param to _syncFrom and sync

    /**
     * Two-way sync to another local Storage instance running in the same process.
     * This is not network-aware.  Network sync is handled by the Syncer class.
     */
    sync(otherStore: IStorage, opts?: SyncOpts): SyncResults;

    // TODO: Delete data locally.  This deletion will not propagate.
    // forget(query : QueryOpts) : void;  // same query options as paths()

    /**
     * Close this storage.
     * 
     * All Storage functions called after this will throw a StorageIsClosedError
     * except for close(), deleteAndClose(), and isClosed().
     * 
     * You can call close() multiple times.
     * Once closed, a Storage instance cannot be opened again.
     * 
     * TODO: what happens when a long-running process like a sync is happening, and the Storage is closed?
     */
    close() : void;
    /** Find out if the storage is closed. */
    isClosed() : boolean;

    /**
     * Close the storage and delete the data locally.
     * This deletion will not propagate to other peers and pubs.
     * This can be called even if the storage is already closed.
     */
    deleteAndClose(): void;
}

export interface IStorageAsync {
    workspace: WorkspaceAddress;
    onWrite: Emitter<WriteEvent>;
    onChange: Emitter<undefined>;

    // QUERYING
    documents(query?: QueryOpts): Promise<Document[]>;
    paths(query?: QueryOpts): Promise<string[]>;
    contents(query?: QueryOpts): Promise<string[]>;
    authors(now?: number): Promise<AuthorAddress[]>;

    // INDIVIDUAL DOCUMENT LOOKUP
    getDocument(path: string, now?: number): Promise<Document | undefined>;
    getContent(path: string, now?: number): Promise<string | undefined>;

    // WRITING
    set(keypair: AuthorKeypair, docToSet: DocToSet, now?: number): Promise<WriteResult | ValidationError>;
    ingestDocument(doc: Document, now?: number, isLocal?: boolean): Promise<WriteResult | ValidationError>;

    // SYNC
    //_syncFrom(otherStore: IStorageAsync, existing: boolean, live: boolean): Promise<number>;
    //sync(otherStore: IStorageAsync, opts?: SyncOpts): Promise<SyncResults>;

    close() : Promise<void>;
    isClosed() : boolean;
}
