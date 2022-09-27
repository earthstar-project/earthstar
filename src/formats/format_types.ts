import { AuthorKeypair } from "../crypto/crypto-types.ts";
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
  ConfigType,
> {
  keypair: AuthorKeypair;
  config: ConfigType;
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
  ConfigType extends Record<string, unknown> | undefined,
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
      ConfigType
    >,
  ): Promise<
    | { doc: DocType; attachment?: ReadableStream<Uint8Array> | Uint8Array }
    | ValidationError
  >;

  /**
   * Sign an unsigned document.
   */
  signDocument(
    keypair: AuthorKeypair,
    doc: DocType,
    config: ConfigType,
  ): Promise<DocType | ValidationError>;

  /**
   * Overwrite the user-written contents of a document, wipes any associated attachments, and signs the document.
   */
  wipeDocument(
    keypair: AuthorKeypair,
    docToWipe: DocType,
    config: ConfigType,
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
    keypair: AuthorKeypair,
    doc: DocType,
    size: number,
    hash: string,
    config: ConfigType,
  ): Promise<DocType | ValidationError>;
}

/** Extracts a IFormat's input type, used to generate a new document. */
export type FormatInputType<FormatterType> = FormatterType extends IFormat<
  infer _FormatType,
  infer DocInputType,
  infer _DocType,
  infer _ConfigType
> ? DocInputType
  : never;

/** Extracts a IFormat's document type, e.g. `DocEs5` */
export type FormatDocType<FormatterType> = FormatterType extends IFormat<
  infer _FormatType,
  infer _DocInputType,
  infer DocType,
  infer _ConfigType
> ? DocType
  : FormatterType extends IFormat<
    infer _FormatType,
    infer _DocInputType,
    infer DocType,
    infer _ConfigType
  >[] ? DocType
  : never;

/** Extracts a IFormat's name, e.g. `es.5` */
export type FormatNameType<FormatterType> = FormatterType extends IFormat<
  infer FormatType,
  infer _DocType,
  infer _DocInputType,
  infer _ConfigType
> ? FormatType
  : never;

/** Extracts a IFormat's config type */
export type FormatConfigType<FormatterType> = FormatterType extends IFormat<
  infer _FormatType,
  infer _DocInputType,
  infer _DocType,
  infer ConfigType
> ? ConfigType
  : FormatterType extends IFormat<
    infer _FormatType,
    infer _DocInputType,
    infer _DocType,
    infer ConfigType
  >[] ? ConfigType
  : never;

export type FormatsConfigRecord<FormatterType> = [FormatterType] extends
  [IFormat<
    infer _F,
    infer _I,
    infer _D,
    infer _C
  >[]] ? {
    [NameType in FormatterType[number]["id"]]: FormatConfigType<
      Extract<
        FormatterType[number],
        { id: NameType }
      >
    >;
  }
  : undefined;

/** Verifies a given type is an array of `IFormat` */
export type FormatsArg<Init> = Init extends
  Array<IFormat<infer _N, infer _I, infer _O, infer _C>> ? Init
  : never;

/** Verifies a given type is of type `IFormat` */
export type FormatArg<Init> = Init extends
  IFormat<infer _N, infer _I, infer _O, infer _C> ? Init
  : never;

export type DefaultFormat = typeof FormatEs5;
export type DefaultFormats = [DefaultFormat];
export type DefaultDoc = DocEs5;
