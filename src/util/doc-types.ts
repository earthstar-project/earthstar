//================================================================================
// PRIMITIVE DATA TYPES SPECIFIC TO OUR CODE

import { ValidationError } from "./errors.ts";

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
  signature: Signature;
  deleteAfter?: number | null;
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

/** An attachment associated with a document. */
export type DocAttachment = {
  /** Returns a stream to use the attachment's bytes chunk by chunk. Useful if the attachment is very big. */
  stream: () => Promise<ReadableStream<Uint8Array>>;
  /** Returns all of the attachments bytes in one go. Handier if you know the attachment is small. */
  bytes: () => Promise<Uint8Array>;
};

/** A document with it's attachment merged onto a new `attachment` property. */
export type DocWithAttachment<D extends DocBase<string>> = D & {
  attachment: DocAttachment | undefined | ValidationError;
};
