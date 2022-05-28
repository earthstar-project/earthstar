import {
  AuthorAddress,
  AuthorKeypair,
  Base32String,
  DocBase,
  DocInputBase,
  FormatName,
  Path,
  ShareAddress,
  Timestamp,
} from "../util/doc-types.ts";
import { ValidationError } from "../util/errors.ts";

export interface ValidatorGenerateOpts<
  FormatType extends string,
  DocInput extends DocInputBase<FormatType>,
> {
  keypair: AuthorKeypair;
  input: DocInput;
  share: ShareAddress;
  timestamp: Timestamp;
}

/** Formatters are each responsible for one document format such as "es.4". They are used for signing and validating documents, as well as generating new documents from a given input.
 */
// According to the rules of Earthstar: documents are validated statelessly,
// one document at a time, without knowing about any other documents
// or what's in the Storage.
export interface IFormatter<
  FormatType extends FormatName,
  DocInputType extends DocInputBase<FormatType>,
  DocType extends DocBase<FormatType>,
> {
  /** The string name of the format, like "es.4" */
  format: FormatType;

  /** Deterministic hash of this version of the document */
  hashDocument(doc: DocType): Promise<Base32String | ValidationError>;

  /**
   * Generate a signed document from the input format the validator expects.
   */
  generateDocument(
    opts: ValidatorGenerateOpts<FormatType, DocInputType>,
  ): Promise<DocType | ValidationError>;

  /**
   * Sign an unsigned document.
   */
  signDocument(
    keypair: AuthorKeypair,
    doc: DocType,
  ): Promise<DocType | ValidationError>;

  /**
   * Overwrite the user-written contents of a document, wipes any associated data, and signs the document.
   */
  wipeDocument(
    keypair: AuthorKeypair,
    docToWipe: DocType,
  ): Promise<DocType | ValidationError>;

  /**
   * Return a copy of the doc without extra fields, plus the extra fields
   * as a separate object.
   * If the input is not a plain javascript object, return a ValidationError.
   * This should be run before checkDocumentIsValid.  The output doc will be more likely to be valid once the extra fields have been removed.
   */
  removeExtraFields(
    doc: DocType,
  ): { doc: DocType; extras: Record<string, unknown> } | ValidationError;

  /**
   * This calls all the more detailed functions which start with underscores.
   * Returns true if the document is ok.
   */
  checkDocumentIsValid(doc: DocType, now?: number): true | ValidationError;

  // These are broken out for easier unit testing.
  // They will not normally be used directly; use the main assertDocumentIsValid instead.
  // Return true on success.
  _checkBasicDocumentValidity(doc: DocType): true | ValidationError; // check for correct fields and datatypes
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
  _checkAuthorSignatureIsValid(doc: DocType): Promise<true | ValidationError>;
  _checkContentMatchesHash(
    content: string,
    contentHash: Base32String,
  ): Promise<true | ValidationError>;

  // TODO: add these methods for building addresses
  // and remove them from crypto.ts and encoding.ts
  // assembleWorkspaceAddress = (name : WorkspaceName, encodedPubkey : EncodedKey) : WorkspaceAddress
  // assembleAuthorAddress = (shortname : AuthorShortname, encodedPubkey : EncodedKey) : AuthorAddress
}

export type ExtractInputType<ValidatorType> = ValidatorType extends
  IFormatter<infer _FormatType, infer DocInputType, infer _DocType>
  ? DocInputType
  : never;

export type ExtractDocType<ValidatorType> = ValidatorType extends
  IFormatter<infer _FormatType, infer _DocInputType, infer DocType> ? DocType
  : never;

export type ExtractFormatType<ValidatorType> = ValidatorType extends
  IFormatter<infer FormatType, infer _DocType, infer _DocInputType> ? FormatType
  : never;
