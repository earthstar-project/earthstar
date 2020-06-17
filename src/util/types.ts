import { Emitter } from './emitter';

export type Path = string;
export type WorkspaceAddress = string;  // sometimes just called "workspace"
export type WorkspaceName = string;  // sometimes just called "author"
export type AuthorAddress = string;
export type AuthorShortname = string;
export type EncodedKey = string; // base58 public or secret key

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

export type Signature = string;  // xxxxxxxxxxxx
export type FormatName = string;

export type Document = {
    format: FormatName,
    workspace: WorkspaceAddress,
    path: Path,
    value: string,
    author: AuthorAddress,
    timestamp: number,
    signature: Signature,
};

// These options are passed to the set() method.
// We don't know the signature yet, but we do need the author secret.
export type DocToSet = {
    format: FormatName,
    path: Path,
    value: string,
    timestamp?: number,  // timestamp only for testing, usually omitted
    // workspace is implied by the storage we put it into
    // no author - the whole keypair is provided separately when setting
    // no signature - it's generated during setting
};

export interface QueryOpts {
    // An empty query object returns all documents.

    // Each of the following adds an additional filter,
    // narrowing down the results further.

    path?: string,  // one specific path only.

    lowPath?: string,  // lowPath <= p 
    highPath?: string,  // p < highPath

    pathPrefix?: string,  // paths starting with prefix.

    // limit applies to the total number of docs returned, counting heads and non-heads
    // there's no offset; use lowPath as a cursor instead
    limit?: number,

    // include old versions of this doc from different authors?
    includeHistory?: boolean, // default false

    // if including history, find keys where the author ever wrote, and return all history for those keys by anyone
    // if not including history, find keys where the author ever wrote, and return the latest doc (maybe not by the author)
    participatingAuthor?: AuthorAddress,

    //// if including history, find keys with the given last-author, and return all history for those keys
    //// if not including history, find keys with the given last-author, and return just the last doc
    //lastAuthor?: AuthorAddress,

    // if including history, it's any revision by this author (heads and non-heads)
    // if not including history, it's any revision by this author which is a head
    versionsByAuthor?: AuthorAddress,

    // timestamp before and after // TODO

    // sort order: TODO
}

export interface SyncOpts {
    direction?: 'push' | 'pull' | 'both',  // default both
    existing?: boolean,  // default true
    live?: boolean,      // default false
}

export interface SyncResults {
    numPushed: number,
    numPulled: number,
}

export interface IValidator {
    // this should be implemented as an abstract class, not a regular class
    format: FormatName;
    pathIsValid(path: Path): boolean;
    authorCanWriteToPath(author: AuthorAddress, path: Path): boolean;
    hashDocument(doc: Document): string;
    signDocument(keypair: AuthorKeypair, doc: Document): Document;
    documentSignatureIsValid(doc: Document): boolean;
    documentIsValid(doc: Document, futureCutoff?: number): boolean;
}

export interface IStorage {
    // the constructor should accept a workspace address
    // constructor(workspace, ...);
    workspace: WorkspaceAddress;

    // onChange is called whenever any data changes.
    // it doesn't yet send any details about the changes.
    // subscribe with onChange.subscribe(...cb...);
    onChange: Emitter<undefined>;

    // sort by path ASC, then timestamp DESC (newest first)
    documents(query?: QueryOpts): Document[];
    paths(query?: QueryOpts): string[];
    values(query?: QueryOpts): string[];

    authors(): AuthorAddress[];

    getDocument(path: string): Document | undefined;
    getValue(path: string): string | undefined;

    set(keypair: AuthorKeypair, docToSet: DocToSet): boolean;  // leave timestamp at 0 and it will be set to now() for you

    ingestDocument(doc: Document): boolean;

    _syncFrom(otherStore: IStorage, existing: boolean, live: boolean): number;
    sync(otherStore: IStorage, opts?: SyncOpts): SyncResults;

    // TODO: Delete data locally.  This deletion will not propagate.
    // forget(query : QueryOpts) : void;  // same query options as paths()
}