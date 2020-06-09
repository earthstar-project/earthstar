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
}

//================================================================================

export type Key = string;
export type RawCryptKey = string;  // xxxxx, in base64, just the integer (not der)
export type Signature = string;  // xxxxxxxxxxxx
export type WorkspaceId = string;
export type FormatName = string;

export interface KeypairBuffers {
    public: Buffer,
    secret: Buffer,
}
export type Keypair = {
    public: RawCryptKey,
    secret: RawCryptKey,
}

export type Item = {
    format : FormatName,
    workspace : WorkspaceId,
    // workspace : string,
    key : string,
    value : string,
    author : RawCryptKey,
    timestamp : number,
    signature : Signature,
}

// These options are passed to the set() method.
// We don't know the signature yet, but we do need the author secret.
export type ItemToSet = {
    format : FormatName,
    // workspace : string,
    key : string,
    value : string,
    // no author - the whole keypair is provided separately when setting
    timestamp? : number,  // timestamp only for testing, usually omitted
    // no signature - it's generated during setting
}

export interface QueryOpts {
    // An empty query object returns all keys.

    // Each of the following adds an additional filter,
    // narrowing down the results further.

    key?: string,  // one specific key only.

    lowKey?: string,  // lowKey <= k
    highKey?: string,  // k < highKey

    prefix?: string,  // keys starting with prefix.

    limit?: number,  // there's no offset; use lowKey as a cursor instead

    // author?: AuthorKey  // TODO: does this include the author's obsolete history items?

    // include old versions of this item from different authors?
    includeHistory?: boolean, // default false
}

export interface SyncOpts {
    direction?: 'push' | 'pull' | 'both',  // default both
    existing?: boolean,  // default true
    live?: boolean,      // default false
}

export interface SyncResults {
    numPushed : number,
    numPulled : number,
}

export interface IValidator {
    // this should be implemented as an abstract class, not a regular class
    format: FormatName;
    keyIsValid(key: Key): boolean;
    authorCanWriteToKey(author: RawCryptKey, key: Key): boolean;
    hashItem(item: Item): string;
    signItem(keypair : Keypair, item: Item): Item;
    itemSignatureIsValid(item: Item): boolean;
    itemIsValid(item: Item, futureCutoff?: number): boolean;
}

export interface IStorage {
    // the constructor should accept a workspace
    // constructor(workspace, ...);
    workspace : WorkspaceId;

    // onChange is called whenever any data changes.
    // it doesn't yet send any details about the changes.
    // subscribe with onChange.subscribe(...cb...);
    onChange : Emitter<undefined>;

    items(query? : QueryOpts) : Item[];
    keys(query? : QueryOpts) : string[];
    values(query? : QueryOpts) : string[];
    // TODO: convenience method to parse value from string to JSON?

    authors() : RawCryptKey[]

    getItem(key : string) : Item | undefined;
    getValue(key : string) : string | undefined;

    set(keypair : Keypair, itemToSet : ItemToSet) : boolean;  // leave timestamp at 0 and it will be set to now() for you

    ingestItem(item : Item) : boolean;

    _syncFrom(otherStore : IStorage, existing : boolean, live : boolean) : number;
    sync(otherStore : IStorage, opts? : SyncOpts) : SyncResults;

    // TODO: Delete data locally.  This deletion will not propagate.
    // forget(query : QueryOpts) : void;  // same query options as keys()
}
