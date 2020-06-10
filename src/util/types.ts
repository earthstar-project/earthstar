import { Emitter } from './emitter';

export type Path = string;
export type WorkspaceAddress = string;
export type WorkspaceName = string;
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

export interface KeypairBuffers {
    public: Buffer,
    secret: Buffer,
}
export type Keypair = {
    public: EncodedKey,
    secret: EncodedKey,
};

//================================================================================

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
    // workspace : string,
    path: Path,
    value: string,
    // no author - the whole keypair is provided separately when setting
    timestamp?: number,  // timestamp only for testing, usually omitted
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

    limit?: number,  // there's no offset; use lowPath as a cursor instead

    // include old versions of this doc from different authors?
    includeHistory?: boolean, // default false

    // author?: AuthorKey  // TODO: does this include the author's obsolete history docs?
    // timestamp before and after // TODO
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
    authorCanWriteToPath(author: EncodedKey, path: Path): boolean;
    hashDocument(doc: Document): string;
    signDocument(keypair: Keypair, doc: Document): Document;
    documentSignatureIsValid(doc: Document): boolean;
    documentIsValid(doc: Document, futureCutoff?: number): boolean;
}

export interface IStorage {
    // the constructor should accept a workspace
    // constructor(workspace, ...);
    workspace: WorkspaceAddress;

    // onChange is called whenever any data changes.
    // it doesn't yet send any details about the changes.
    // subscribe with onChange.subscribe(...cb...);
    onChange: Emitter<undefined>;

    documents(query?: QueryOpts): Document[];
    paths(query?: QueryOpts): string[];
    values(query?: QueryOpts): string[];

    authors(): EncodedKey[];

    getDocument(path: string): Document | undefined;
    getValue(path: string): string | undefined;

    set(keypair: Keypair, docToSet: DocToSet): boolean;  // leave timestamp at 0 and it will be set to now() for you

    ingestDocument(doc: Document): boolean;

    _syncFrom(otherStore: IStorage, existing: boolean, live: boolean): number;
    sync(otherStore: IStorage, opts?: SyncOpts): SyncResults;

    // TODO: Delete data locally.  This deletion will not propagate.
    // forget(query : QueryOpts) : void;  // same query options as paths()
}
