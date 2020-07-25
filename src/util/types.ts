import { Emitter } from './emitter';

export class ValidationError extends Error {
    constructor(message : string) {
        super(message);
        this.name = "ValidationError";
    }
}

export type Path = string;

// some vocabulary:
//   WorkspaceAddress = '+' + WorkspaceName + '.' + (WorkspacePubkey | WorkspaceRandom)
//   AuthorAddress = '@' + AuthorShortname + '.' + AuthorPubkey

export type WorkspaceAddress = string;
export type WorkspaceName = string;

export type AuthorAddress = string;
export type AuthorShortname = string;

export type EncodedKey = string; // a pubkey or secret key as base58

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

export type Signature = string;

// A document format such as "es.4".
export type FormatName = string;

// The main type for Earthstar documents.
// TODO: is this type specific to the es.4 format, or is it a universal requirement for all Earthstar formats?
export type Document = {
    format: FormatName,
    workspace: WorkspaceAddress,
    path: Path,
    content: string,
    author: AuthorAddress,
    timestamp: number,
    signature: Signature,
};

// A more limited version of a Document, used by the Storage.set() method
export type DocToSet = {
    format: FormatName,
    path: Path,
    content: string,
    timestamp?: number,  // timestamp only for testing, usually omitted
    // workspace is implied by the storage we put it into
    // no author - the whole keypair is provided separately when setting
    // no signature - it's generated during setting
};

// Query objects describe how we want to query a Storage instance for documents.
export interface QueryOpts {
    // An empty query object returns all documents.

    // Each of the following adds an additional filter,
    // narrowing down the results further.

    path?: string,  // one specific path only.

    lowPath?: string,  // lowPath <= p 
    highPath?: string,  // p < highPath

    pathPrefix?: string,  // paths starting with prefix.

    // Only return the first N documents.
    // This counts the total number of docs returned, counting historical and most-recent versions.
    // There's no offset; use lowPath as a cursor instead
    limit?: number,

    // Include old versions of this doc from different authors?
    includeHistory?: boolean, // default false

    // If including history, find paths where the author ever wrote, and return all history for those paths by anyone
    // If not including history, find paths where the author ever wrote, and return the latest doc (maybe not by the author)
    participatingAuthor?: AuthorAddress,

    //// If including history, find paths with the given last-author, and return all history for those paths
    //// If not including history, find paths with the given last-author, and return just the last doc
    //lastAuthor?: AuthorAddress,

    // If including history, it's any revision by this author (heads and non-heads)
    // If not including history, it's any revision by this author which is a head
    versionsByAuthor?: AuthorAddress,

    // timestamp before and after // TODO

    // sort order: TODO
    // For now the default sort is path ASC, then timestamp DESC (newest first within same path)
}

// Options for the Storage.sync() method
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

// Stats about what happened in a sync
export interface SyncResults {
    // number of documents that the other side didn't already have, that they accepted from us
    numPushed: number,
    // number that we accepted from the other side
    numPulled: number,
}

export interface IValidator {
    // Validators are each responsible for one document format such as "es.4".
    // They are used by Storage instances to
    // * check if documents are valid before accepting them
    // * sign new documents

    // According to the rules of Earthstar: documents are validated statelessly,
    // one document at a time, without knowing about any other documents
    // or what's in the Storage.

    // These are all static methods.
    // You won't be making instances of Validators because they have no state.
    // They're just a collection of functions.

    // The string name of the format, like "es.4"
    format: FormatName;

    // Deterministic hash of this version of the document
    hashDocument(doc: Document): string;

    // Add an author signature to the document.
    // The input document needs a signature field to satisfy Typescript, but
    // it will be overwritten here, so you may as well just set signature: '' on the input
    signDocument(keypair: AuthorKeypair, doc: Document): Document;

    // General validity check including the specific checks (can write to path, path is valid, signature)
    // plus other checks (missing fields, wrong datatypes, etc)
    documentIsValid(doc: Document, futureCutoff?: number): boolean;

    // Specific validity checks
    authorCanWriteToPath(author: AuthorAddress, path: Path): boolean;
    pathIsValid(path: Path): boolean;
    documentSignatureIsValid(doc: Document): boolean;
}

export interface IStorage {
    // A Storage instance holds the documents of a single workspace.
    // To construct one, you need to supply
    //   * a workspace address
    //   * a list of Validator classes, for the document formats you want to support
    //   * various other options such as database filenames, specific to that kind of Storage

    // The workspace held in this Storage object.
    workspace: WorkspaceAddress;

    // onChange is called whenever any data changes:
    //   * after every set()
    //   * after every ingestDocument()
    //   * after each document obtained during a sync (because that happens via ingestDocument())
    // It doesn't yet send any details about the changes to the callback, but it should.
    // Subscribe with onChange.subscribe(...cb...);
    onChange: Emitter<undefined>;

    // QUERYING
    // Return the documents that match the query.
    // Default sort is path ASC, then timestamp DESC (newest first within same path)
    //  but query objects will eventually include sort options.
    documents(query?: QueryOpts): Document[];
    // Same as documents(), but only return the distinct paths of the matching documents (duplicates removed).
    paths(query?: QueryOpts): string[];
    // Same as documents(), but only return the content properties of the matching documents.
    contents(query?: QueryOpts): string[];

    // List of authors that have ever written in this workspace.
    authors(): AuthorAddress[];

    // INDIVIDUAL DOCUMENT LOOKUP
    // Get one document by path.
    // Only returns the most recent document at this path.
    // To get older docs at this path (from other authors), do a query.
    getDocument(path: string): Document | undefined;
    // Same as getDocument(path).content -- just the content of that document
    getContent(path: string): string | undefined;

    // WRITING
    // Write a document.
    // To do this you need to know an author's private key, which is part of the keypair object.
    // The DocToSet type is similar but smaller than a regular document:
    //   format: which document format to use
    //   path
    //   content
    //   timestamp: optional.  If absent or zero, the current time is set for you
    //   - no workspace -- this Storage object knows what workspace it is
    //   - no author -- it's provided in the keypair argument
    //   - no signature -- it will be signed for you
    // Timestamps should only be set manually for testing purposes.  Normally they should be
    // omitted so they default to now.
    // The timestamp will also be increased so that it's greater than any previous doc
    // at the same path (from any author), to guarantee that this write will be the conflict winner.
    set(keypair: AuthorKeypair, docToSet: DocToSet): boolean;

    // Save a document from an external source to this Storage instance.
    // The document must be already signed.
    // This is mostly used for syncing.
    ingestDocument(doc: Document): boolean;

    // Internal helper method to do a one-way pull sync.
    _syncFrom(otherStore: IStorage, existing: boolean, live: boolean): number;

    // Two-way sync to another local Storage instance running in the same process.
    // This is not network-aware.  Network sync is handled by the Syncer class.
    sync(otherStore: IStorage, opts?: SyncOpts): SyncResults;

    // TODO: Delete data locally.  This deletion will not propagate.
    // forget(query : QueryOpts) : void;  // same query options as paths()
}
