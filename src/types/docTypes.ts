//================================================================================ 
// PRIMITIVE DATA TYPES SPECIFIC TO OUR CODE

export type AuthorAddress = string;
export type AuthorShortname = string;
export type WorkspaceAddress = string;
export type WorkspaceName = string;
export type Path = string;
export type Signature = string;
export type Timestamp = number;
export type LocalIndex = number;
export type Base32String = string;
export type FormatName = string;

export interface AuthorKeypair {
    address: AuthorAddress,
    secret: string,
}

export type ParsedAddress = {
    address: AuthorAddress,
    name: AuthorShortname,
    pubkey: Base32String,
};

//================================================================================ 
// DOCUMENTS

export interface Doc {
    // TODO: format
    format: string,
    author: AuthorAddress,
    content: string,
    contentHash: string,
    contentLength: number,
    path: Path,
    signature: Signature,
    timestamp: Timestamp,
    workspace: WorkspaceAddress,

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
export interface DocToSet {
    workspace: WorkspaceAddress,
    path: Path,
    content: string,
}
