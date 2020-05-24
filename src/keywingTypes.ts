export type Key = string;
export type AuthorKey = string;  // @xxxxx.ed25519
export type RawCryptKey = string;  // xxxxx, in base64, just the integer (not der)
export type Signature = string;  // xxxxxxxxxxxx.sig.ed25519

export type Keypair = {
    public: RawCryptKey,
    secret: RawCryptKey,
}

export type WorkspaceId = string;

type Schema = 'kw.1';
export type Item = {
    schema : Schema,
    workspace : WorkspaceId,
    // workspace : string,
    key : string,
    value : string,
    author : AuthorKey,
    timestamp : number,
    signature : Signature,
}

// These options are passed to the set() method.
// We don't know the signature yet, but we do need the author secret.
export type ItemToSet = {
    schema? : Schema,  // schema defaults to latest version of kw.N
    // workspace : string,
    key : string,
    value : string,
    author : AuthorKey,
    authorSecret : RawCryptKey,
    timestamp? : number,  // timestamp only for testing
    // no signature
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

export interface IKeywingStore {
    // the constructor should accept a workspace
    // constructor(workspace, ...);
    workspace : WorkspaceId;

    items(query? : QueryOpts) : Item[];
    keys(query? : QueryOpts) : string[];
    values(query? : QueryOpts) : string[];
    // TODO: convenience method to parse value from string to JSON?

    getItem(key : string) : Item | undefined;
    getValue(key : string) : string | undefined;

    set(itemToSet : ItemToSet) : boolean;  // leave timestamp at 0 and it will be set to now() for you

    ingestItem(item : Item) : boolean;

    _syncFrom(otherKeywing : IKeywingStore, existing : boolean, live : boolean) : number;
    sync(otherKeywing : IKeywingStore, opts? : SyncOpts) : SyncResults;

    // TODO: change feed
    // onChange(cb);

    // TODO: Delete data locally.  This deletion will not propagate.
    // forget(query : QueryOpts) : void;  // same query options as keys()
}
