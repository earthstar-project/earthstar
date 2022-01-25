//================================================================================
// PRIMITIVE DATA TYPES SPECIFIC TO OUR CODE

/** An identity's public address. */
export type AuthorAddress = string;
/** The human-identifiable portion of an identity's public address, e.g. `suzy`. */
export type AuthorShortname = string;
/** A share's public address. */
export type WorkspaceAddress = string;
/** The human-identifiable portion of a share's address, e.g. `gardening`. */
export type WorkspaceName = string;
/** The path of a document, e.g. `/images/teapot.png`. */
export type Path = string;
export type Signature = string;
/** A UNIX timestamp in microseconds. */
export type Timestamp = number;
export type LocalIndex = number;
export type Base32String = string;
export type FormatName = string;

/** An identity used to sign documents. */
export interface AuthorKeypair {
  address: AuthorAddress;
  secret: string;
}

export type ParsedAddress = {
  address: AuthorAddress;
  name: AuthorShortname;
  pubkey: Base32String;
};

//================================================================================
// DOCUMENTS

/** Contains data written and signed by an identity. */
export interface Doc {
  /** Which document format the doc adheres to, e.g. `es.4`. */
  format: string;
  author: AuthorAddress;
  content: string; // TODO: | null, when we have sparse mode
  contentHash: string;
  //contentLength: number,  // TODO: add for sparse mode, and enforce in the format validator
  /** When the document should be deleted, as a UNIX timestamp in microseconds. */
  deleteAfter: number | null;
  path: Path;
  /** Used to verify the authorship of the document. */
  signature: Signature;
  /** When the document was written, as a UNIX timestamp in microseconds (millionths of a second, e.g. `Date.now() * 1000`).*/
  timestamp: Timestamp;
  workspace: WorkspaceAddress;
  // workspaceSignature: Signature,  // TODO: add for sparse mode

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
  //    knownPeerMaxLocalIndexes:
  //        peer111: 77
  //        peer222: 140
  // ...which helps us continue syncing with that specific peer next time.
  //
  // When we upsert the doc into our own storage, we discard the other peer's value
  // and replace it with our own localIndex.
  //
  // The localIndex is not included in the doc's signature.
  _localIndex?: LocalIndex;
}

/** A partial doc that is about to get written. The rest of the properties will be computed automatically. */
export interface DocToSet {
  /** The format the document adheres to, e.g. `es.4` */
  format: string;
  path: Path;
  content: string;
  /** A UNIX timestamp in microseconds indicating when the document was written. Determined automatically if omitted. */
  timestamp?: number;
  /** A UNIX timestamp in microseconds indicating when the document should be deleted by.*/
  deleteAfter?: number | null;
}
