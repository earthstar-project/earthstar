import {
  AuthorAddress,
  Base32String,
  DocBase,
  DocInputBase,
  FormatName,
  ShareAddress,
  Timestamp,
} from "../util/doc-types.ts";
import { ValidationError } from "../util/errors.ts";
import { DocEs5, FormatEs5 } from "./format_es5.ts";

export interface FormatterGenerateOpts<
  FormatType extends string,
  DocInput extends DocInputBase<FormatType>,
  DocType extends DocBase<FormatType>,
  CredentialsType,
> {
  credentials: CredentialsType;
  input: DocInput;
  share: ShareAddress;
  timestamp: Timestamp;
  prevLatestDoc?: DocType;
}

/** Formats are each responsible for one document format such as "es.4". They are used for signing and validating documents, as well as generating new documents from a given input.
 */
// According to the rules of Earthstar: documents are validated statelessly,
// one document at a time, without knowing about any other documents
// or what's in the Storage.
export interface IFormat<
  FormatType extends FormatName,
  DocInputType extends DocInputBase<FormatType>,
  DocType extends DocBase<FormatType>,
  CredentialsType,
> {
  /** The string name of the format, like "es.4" */
  id: FormatType;

  /** Deterministic hash of this version of the document */
  hashDocument(doc: DocType): Promise<Base32String | ValidationError>;

  /**
   * Generate a signed document from the input format the validator expects.
   */
  generateDocument(
    opts: FormatterGenerateOpts<
      FormatType,
      DocInputType,
      DocType,
      CredentialsType
    >,
  ): Promise<
    | { doc: DocType; attachment?: ReadableStream<Uint8Array> | Uint8Array }
    | ValidationError
  >;

  /**
   * Sign an unsigned document.
   */
  signDocument(
    credentials: CredentialsType,
    doc: DocType,
  ): Promise<DocType | ValidationError>;

  /**
   * Overwrite the user-written contents of a document, wipes any associated attachments, and signs the document.
   */
  wipeDocument(
    credentials: CredentialsType,
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
  checkDocumentIsValid(
    doc: DocType,
    now?: number,
  ): Promise<true | ValidationError>;

  /**
   * Returns information about a doc's attachment, if it has one. If it doesn't, a `ValidationError` will be returned. This does not indicate if that attachment is actually present locally.
   */
  getAttachmentInfo(doc: DocType): {
    size: number;
    hash: string;
  } | ValidationError;

  /**
   * Some information can only be known once an attachment (especially if it comes in the form of a stream) has been consumed. For this reason, a Formatter's `generateDocument` method may not be able to generate a valid document for a attachment, even if it already knows it has one.
   */
  updateAttachmentFields(
    credentials: CredentialsType,
    doc: DocType,
    size: number,
    hash: string,
  ): Promise<DocType | ValidationError>;

  /** Extracts the author address from a credentials item this format expects. */
  authorFromCredentials(credentials: CredentialsType): AuthorAddress;
}

/** Extracts a IFormat's input type, used to generate a new document. */
export type FormatInputType<FormatterType> = FormatterType extends IFormat<
  infer _FormatType,
  infer DocInputType,
  infer _DocType,
  infer _CredentialsType
> ? DocInputType
  : never;

/** Extracts a IFormat's document type, e.g. `DocEs5` */
export type FormatDocType<FormatterType> = FormatterType extends IFormat<
  infer _FormatType,
  infer _DocInputType,
  infer DocType,
  infer _CredentialsType
> ? DocType
  : FormatterType extends IFormat<
    infer _FormatType,
    infer _DocInputType,
    infer DocType,
    infer _CredentialsType
  >[] ? DocType
  : never;

/** Extracts a IFormat's name, e.g. `es.5` */
export type FormatNameType<FormatterType> = FormatterType extends IFormat<
  infer FormatType,
  infer _DocType,
  infer _DocInputType,
  infer _CredentialsType
> ? FormatType
  : never;

/** Extracts a IFormat's credentials type, e.g. a keypair */
export type FormatCredentialsType<FormatterType> = FormatterType extends
  IFormat<
    infer _FormatType,
    infer _DocType,
    infer _DocInputType,
    infer CredentialsType
  > ? CredentialsType
  : never;

/** Verifies a given type is an array of `IFormat` */
export type FormatsArg<Init> = Init extends
  Array<IFormat<infer _N, infer _I, infer _O, infer _C>> ? Init : never;

/** Verifies a given type is of type `IFormat` */
export type FormatArg<Init> = Init extends
  IFormat<infer _N, infer _I, infer _O, infer _C> ? Init
  : never;

export type DefaultFormat = typeof FormatEs5;
export type DefaultFormats = [DefaultFormat];
export type DefaultDoc = DocEs5;
