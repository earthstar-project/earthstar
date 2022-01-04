import {
  AuthorAddress,
  AuthorKeypair,
  Base32String,
  Doc,
  FormatName,
  Path,
} from "../util/doc-types.ts";
import { ValidationError } from "../util/errors.ts";

/**
 * Validators are each responsible for one document format such as "es.4".
 * They are used by Storage instances to
 * * check if documents are valid before accepting them
 * * sign new documents
 *
 * According to the rules of Earthstar: documents are validated statelessly,
 * one document at a time, without knowing about any other documents
 * or what's in the Storage.
 */
export interface IFormatValidator {
  /** The string name of the format, like "es.4" */
  format: FormatName;

  /** Deterministic hash of this version of the document */
  hashDocument(doc: Doc): Promise<Base32String | ValidationError>;

  /**
   * Add an author signature to the document.
   * The input document needs a signature field to satisfy Typescript, but
   * it will be overwritten here, so you may as well just set signature: '' on the input.
   * Return a copy of the original document with the signature field changed, or return a ValidationError.
   */
  signDocument(
    keypair: AuthorKeypair,
    doc: Doc,
  ): Promise<Doc | ValidationError>;

  /**
   * Return a copy of the doc without extra fields, plus the extra fields
   * as a separate object.
   * If the input is not a plain javascript object, return a ValidationError.
   * This should be run before checkDocumentIsValid.  The output doc will be
   * more likely to be valid once the extra fields have been removed.
   */
  removeExtraFields(
    doc: Doc,
  ): { doc: Doc; extras: Record<string, any> } | ValidationError;

  /**
   * This calls all the more detailed functions which start with underscores.
   * Returns true if the document is ok.
   */
  checkDocumentIsValid(doc: Doc, now?: number): true | ValidationError;

  // These are broken out for easier unit testing.
  // They will not normally be used directly; use the main assertDocumentIsValid instead.
  // Return true on success.
  _checkBasicDocumentValidity(doc: Doc): true | ValidationError; // check for correct fields and datatypes
  _checkAuthorCanWriteToPath(
    author: AuthorAddress,
    path: Path,
  ): true | ValidationError;
  _checkTimestampIsOk(
    timestamp: number,
    deleteAfter: number | null,
    now: number,
  ): true | ValidationError;
  _checkPathIsValid(
    path: Path,
    deleteAfter?: number | null,
  ): true | ValidationError;
  _checkAuthorSignatureIsValid(doc: Doc): Promise<true | ValidationError>;
  _checkContentMatchesHash(
    content: string,
    contentHash: Base32String,
  ): Promise<true | ValidationError>;

  // TODO: add these methods for building addresses
  // and remove them from crypto.ts and encoding.ts
  // assembleWorkspaceAddress = (name : WorkspaceName, encodedPubkey : EncodedKey) : WorkspaceAddress
  // assembleAuthorAddress = (shortname : AuthorShortname, encodedPubkey : EncodedKey) : AuthorAddress
}
