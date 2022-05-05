//================================================================================
// PRIMITIVE DATA TYPES SPECIFIC TO OUR CODE

/** An identity's public address. */
export type AuthorAddress = string;
/** The human-identifiable portion of an identity's public address, e.g. `suzy`. */
export type AuthorShortname = string;
/** A share's public address. */
export type ShareAddress = string;
/** The human-identifiable portion of a share's address, e.g. `gardening`. */
export type ShareName = string;
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

/** The core properties all documents must implement, regardless of format. */
export interface DocBase<FormatType extends string> {
  format: FormatType;
  path: string;
  author: AuthorAddress;
  timestamp: Timestamp;
  deleteAfter: Timestamp | null;
  signature: Signature;
  _localIndex?: number;
}

export interface DocInputBase<FormatType extends string> {
  format: FormatType;
  path: string;
  timestamp?: Timestamp;
}

export type DocWithFormat<
  FormatType extends string,
  DocType extends DocBase<string>,
> = Extract<DocType, { "format": FormatType }>;

export type DocInputWithFormat<
  FormatType extends string,
  DocInputType extends DocInputBase<string>,
> = Extract<DocInputType, { "format": FormatType }>;
