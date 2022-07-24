import {
  AuthorKeypair,
  Base32String,
  DocBase,
  DocInputBase,
  FormatName,
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
export interface IFormat<
  FormatType extends FormatName,
  DocInputType extends DocInputBase<FormatType>,
  DocType extends DocBase<FormatType>,
> {
  /** The string name of the format, like "es.4" */
  id: FormatType;

  /** Deterministic hash of this version of the document */
  hashDocument(doc: DocType): Promise<Base32String | ValidationError>;

  /**
   * Generate a signed document from the input format the validator expects.
   */
  generateDocument(
    opts: ValidatorGenerateOpts<FormatType, DocInputType>,
  ): Promise<
    | { doc: DocType; blob?: ReadableStream<Uint8Array> | Uint8Array }
    | ValidationError
  >;

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

  /**
   * Returns a boolean indicating if it is *possible* for the given document to have a blob associated with it. This does not indicate if that blob is actually present locally.
   */
  docCanHaveBlob(doc: DocType): boolean;

  checkBlobMatchesDoc(
    blob: Uint8Array | ReadableStream<Uint8Array>,
    doc: DocType,
  ): Promise<true | ValidationError>;
  // TODO: add these methods for building addresses
  // and remove them from crypto.ts and encoding.ts
  // assembleWorkspaceAddress = (name : WorkspaceName, encodedPubkey : EncodedKey) : WorkspaceAddress
  // assembleAuthorAddress = (shortname : AuthorShortname, encodedPubkey : EncodedKey) : AuthorAddress
}

export type FormatInputType<FormatterType> = FormatterType extends
  IFormat<infer _FormatType, infer DocInputType, infer _DocType> ? DocInputType
  : never;

export type FormatDocType<FormatterType> = FormatterType extends
  IFormat<infer _FormatType, infer _DocInputType, infer DocType> ? DocType
  : never;

export type FormatterFormatType<FormatterType> = FormatterType extends
  IFormat<infer FormatType, infer _DocType, infer _DocInputType> ? FormatType
  : never;
