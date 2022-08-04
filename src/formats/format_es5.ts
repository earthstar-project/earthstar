import {
  AuthorAddress,
  AuthorKeypair,
  Base32String,
  DocBase,
  DocInputBase,
  LocalIndex,
  Path,
  ShareAddress,
  Signature,
  Timestamp,
} from "../util/doc-types.ts";
import { isErr, ValidationError } from "../util/errors.ts";
import { FormatterGenerateOpts, IFormat } from "./format_types.ts";
import { Crypto } from "../crypto/crypto.ts";

import {
  authorAddressChars,
  b32chars,
  pathChars,
  workspaceAddressChars,
} from "../core-validators/characters.ts";
import {
  checkInt,
  checkLiteral,
  checkObj,
  CheckObjOpts,
  checkString,
  isPlainObject,
} from "../core-validators/checkers.ts";
import {
  checkAuthorIsValid,
  checkShareIsValid,
} from "../core-validators/addresses.ts";

//--------------------------------------------------

import { Logger } from "../util/log.ts";
let logger = new Logger("validator es.5", "red");

//================================================================================

/** Contains data written and signed by an identity. */
export interface DocEs5 extends DocBase<"es.5"> {
  /** Which document format the doc adheres to, e.g. `es.4`. */
  format: "es.5";
  author: AuthorAddress;
  text: string;
  textHash: string;

  //contentLength: number,  // TODO: add for sparse mode, and enforce in the format validator
  /** When the document should be deleted, as a UNIX timestamp in microseconds. */
  deleteAfter?: number;
  path: Path;
  /** Used to verify the authorship of the document. */
  signature: Signature;
  /** When the document was written, as a UNIX timestamp in microseconds (millionths of a second, e.g. `Date.now() * 1000`).*/
  timestamp: Timestamp;
  /** The share this document is from.
   */
  share: ShareAddress;
  // workspaceSignature: Signature,  // TODO: add for sparse mode

  // The size of the associated attachment, if any.
  attachmentSize?: number;
  // The hash of the associated attachment, if any.
  attachmentHash?: string;

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

/** A partial es.4 doc that is about to get written. The rest of the properties will be computed automatically. */
export interface DocInputEs5 extends DocInputBase<"es.5"> {
  /** The format the document adheres to, e.g. `es.5` */
  format: "es.5";
  path: Path;
  text?: string;

  /** Data as Uint8Array or ReadableStream, to be used as document's associated attachment. */
  attachment?: Uint8Array | ReadableStream;

  /** A UNIX timestamp in microseconds indicating when the document was written. Determined automatically if omitted. */
  timestamp?: number;
  /** A UNIX timestamp in microseconds indicating when the document should be deleted by.*/
  deleteAfter?: number | null;
}

// Tolerance for accepting messages from the future (because of clock skew between peers)
const FUTURE_CUTOFF_MINUTES = 10;
const FUTURE_CUTOFF_MICROSECONDS = FUTURE_CUTOFF_MINUTES * 60 * 1000 * 1000;

// Allowed valid range of timestamps (in microseconds, not milliseconds)
const MIN_TIMESTAMP = 10000000000000; // 10^13
const MAX_TIMESTAMP = 9007199254740990; // Number.MAX_SAFE_INTEGER - 1

const MAX_TEXT_LENGTH = 8000; // 4 million bytes = 4 megabytes (measured as bytes of utf-8, not normal string length)

const HASH_STR_LEN = 53; // number of base32 characters including leading 'b', which is 32 raw bytes when decoded
const SIG_STR_LEN = 104; // number of base32 characters including leading 'b', which is 64 raw bytes when decoded

const MIN_BLOB_SIZE = 0;
const MAX_BLOB_SIZE = Number.MAX_SAFE_INTEGER;

const ES5_CORE_SCHEMA: CheckObjOpts = {
  objSchema: {
    format: checkLiteral("es.5"),
    author: checkString({ allowedChars: authorAddressChars }),
    text: checkString({ maxLen: MAX_TEXT_LENGTH }),
    textHash: checkString({ allowedChars: b32chars, len: HASH_STR_LEN }),
    deleteAfter: checkInt({
      min: MIN_TIMESTAMP,
      max: MAX_TIMESTAMP,
      optional: true,
    }),
    path: checkString({ allowedChars: pathChars, minLen: 2, maxLen: 512 }),
    signature: checkString({ allowedChars: b32chars, len: SIG_STR_LEN }),
    timestamp: checkInt({ min: MIN_TIMESTAMP, max: MAX_TIMESTAMP }),
    share: checkString({ allowedChars: workspaceAddressChars }),
    attachmentSize: checkInt({
      min: MIN_BLOB_SIZE,
      max: MAX_BLOB_SIZE,
      optional: true,
    }),
    attachmentHash: checkString({
      allowedChars: b32chars,
      len: HASH_STR_LEN,
      optional: true,
    }),
  },
  allowLiteralUndefined: false,
  allowExtraKeys: false,
};

/**
 * Validator for the 'es.4' format. Checks if documents are spec-compliant before ingesting, and signs them according to spec.
 * @link https://earthstar-project.org/specs/data-spec
 */
export const FormatEs5: IFormat<"es.5", DocInputEs5, DocEs5> = class {
  static id: "es.5" = "es.5";

  /** Deterministic hash of this version of the document */
  static hashDocument(
    doc: DocEs5,
  ): Promise<Base32String | ValidationError> {
    // Deterministic hash of the document.
    // Can return a ValidationError, but only checks for very basic document validity.

    // The hash of the document is used for signatures and references to specific docs.
    // We use the hash of the content in case we want to drop the actual content
    // and only keep the hash around for verifying signatures.
    // None of these fields are allowed to contain tabs or newlines
    // (except content, but we use contentHash instead).

    // to check the basic validity it needs a signature of the correct length and characters,
    // but the actual content of the signature is not checked here.
    // so let's fake it.
    const docWithFakeSig = {
      ...doc,
      signature:
        "bthisisafakesignatureusedtofillintheobjectwhenvalidatingitforhashingaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    const err = this._checkBasicDocumentValidity(docWithFakeSig);
    if (isErr(err)) return Promise.resolve(err);

    // Sort fields in lexicographic order by field name.
    // let result = ''
    // For each field,
    //     skip "content" and "signature" fields.
    //     skip fields with value === null.
    //     result += fieldname + "\t" + convertToString(value) + "\n"
    // return base32encode(sha256(result).binaryDigest())
    return Crypto.sha256base32(
      `author\t${doc.author}\n` +
        `textHash\t${doc.textHash}\n` +
        (doc.attachmentSize === undefined ? "" : `attachmentSize\t${doc.attachmentSize}\n`) +
        (doc.attachmentHash === undefined ? "" : `attachmentHash\t${doc.attachmentHash}\n`) +
        (doc.deleteAfter === undefined
          ? ""
          : `deleteAfter\t${doc.deleteAfter}\n`) +
        `format\t${doc.format}\n` +
        `path\t${doc.path}\n` +
        `timestamp\t${doc.timestamp}\n` +
        `share\t${doc.share}\n`, // \n at the end also, not just between
    );
  }

  /**
   * Generate a signed document from the input format the validator expects.
   */
  static async generateDocument(
    { input, keypair, share, timestamp, prevLatestDoc }: FormatterGenerateOpts<
      "es.5",
      DocInputEs5,
      DocEs5
    >,
  ): Promise<
    | { doc: DocEs5; attachment?: ReadableStream<Uint8Array> | Uint8Array }
    | ValidationError
  > {
    if (input.text === undefined && prevLatestDoc?.text === undefined) {
      return new ValidationError(
        "Couldn't determine document text from given input or previous version's text.",
      );
    }

    const nextText = input.text || prevLatestDoc?.text as string;

    const doc: DocEs5 = {
      ...prevLatestDoc,
      format: "es.5",
      author: keypair.address,
      text: nextText,
      textHash: await Crypto.sha256base32(nextText),
      path: input.path,
      timestamp,
      share,
      signature: "?", // signature will be added in just a moment
      // _localIndex will be added during upsert.  it's not needed for the signature.
    };

    if (input.deleteAfter) {
      doc["deleteAfter"] = input.deleteAfter;
    }

    const signed = await this.signDocument(keypair, doc);

    if (isErr(signed)) {
      return signed;
    }

    if (input.attachment) {
      return { doc: signed, attachment: input.attachment };
    }

    return { doc: signed };
  }

  /**
   * Generate a signed document from the input format the validator expects.
   */
  static async signDocument(
    keypair: AuthorKeypair,
    doc: DocEs5,
  ): Promise<DocEs5 | ValidationError> {
    const hash = await this.hashDocument(doc);
    if (isErr(hash)) return hash;

    const sig = await Crypto.sign(keypair, hash);
    if (isErr(sig)) return sig;

    return { ...doc, signature: sig };
  }

  /**
   * Overwrite the user-written contents of a document, wipe any associated data, and return the signed document.
   */
  static async wipeDocument(
    keypair: AuthorKeypair,
    doc: DocEs5,
  ): Promise<DocEs5 | ValidationError> {
    if (doc.text.length === 0) {
      return doc;
    }

    const cleanedResult = this.removeExtraFields(doc);
    if (isErr(cleanedResult)) return cleanedResult;
    const cleanedDoc = cleanedResult.doc;

    if (cleanedDoc.attachmentHash) {
      const emptyDoc: DocEs5 = {
        ...cleanedDoc,
        text: "",
        textHash: await Crypto.sha256base32(""),
        signature: "?",
        attachmentHash: await Crypto.sha256base32(""),
        attachmentSize: 0,
      };

      return this.signDocument(keypair, emptyDoc);
    }

    // make new doc which is empty and just barely newer than the original
    const emptyDoc: DocEs5 = {
      ...cleanedDoc,
      text: "",
      textHash: await Crypto.sha256base32(""),
      signature: "?",
    };

    return this.signDocument(keypair, emptyDoc);
  }

  /**
   * Return a copy of the doc without extra fields, plus the extra fields
   * as a separate object.
   * If the input is not a plain javascript object, return a ValidationError.
   * This should be run before checkDocumentIsValid.  The output doc will be
   * more likely to be valid once the extra fields have been removed.
   */
  static removeExtraFields(
    doc: DocEs5,
  ): { doc: DocEs5; extras: Record<string, any> } | ValidationError {
    if (!isPlainObject(doc)) {
      return new ValidationError("doc is not a plain javascript object");
    }
    const validKeys = new Set(Object.keys(ES5_CORE_SCHEMA.objSchema || {}));

    const doc2: Record<string, any> = {};
    const extras: Record<string, any> = {};
    for (const [key, val] of Object.entries(doc)) {
      if (validKeys.has(key)) {
        doc2[key] = val;
      } else {
        if (!key.startsWith("_")) {
          return new ValidationError(
            "extra document fields must have names starting with an underscore",
          );
        }
        extras[key] = val;
      }
    }
    return {
      doc: doc2 as DocEs5,
      extras,
    };
  }

  /**
   * This calls all the more detailed functions which start with underscores.
   * Returns true if the document is ok, or returns a ValidationError if anything is wrong.
   * Normally `now` should be omitted so that it defaults to the current time,
   * or you can override it for testing purposes.
   */
  static checkDocumentIsValid(
    doc: DocEs5,
    now?: number,
  ): true | ValidationError {
    if (now === undefined) now = Date.now() * 1000;
    // do this first to ensure we have all the right datatypes in the right fields

    const errBV = this._checkBasicDocumentValidity(doc);
    if (isErr(errBV)) return errBV;

    // this is the most likely to fail under regular conditions, so do it next
    // (because of clock skew and expired ephemeral documents)
    const errT = this._checkTimestampIsOk(
      doc.timestamp,
      doc.deleteAfter ? doc.deleteAfter : null,
      now,
    );
    if (isErr(errT)) return errT;

    const errW = this._checkAuthorCanWriteToPath(doc.author, doc.path);
    if (isErr(errW)) return errW;

    // Check that all attachment fields are defined
    const errBFC = this._checkAttachmentFieldsConsistent(doc);
    if (isErr(errBFC)) return errBFC;

    const errP = this._checkPathIsValid(
      doc.path,
      !!doc.attachmentHash,
      doc.deleteAfter,
    );
    if (isErr(errP)) return errP;

    const errAA = checkAuthorIsValid(doc.author);
    if (isErr(errAA)) return errAA;

    const errWA = checkShareIsValid(doc.share);
    if (isErr(errWA)) return errWA;

    // do this after validating that the author address is well-formed
    // so we don't pass garbage into the crypto signature code
    const errS = this._checkAuthorSignatureIsValid(doc);
    if (isErr(errS)) return errS;

    const errCH = this._checkContentMatchesHash(doc.text, doc.textHash);
    if (isErr(errCH)) return errCH;
    return true;
  }

  // These are broken out for easier unit testing.
  // They will not normally be used directly; use the main assertDocumentIsValid instead.
  // Return true on success.
  static _checkBasicDocumentValidity(doc: DocEs5): true | ValidationError { // check for correct fields and datatypes
    const err = checkObj(ES5_CORE_SCHEMA)(doc);
    if (err !== null) return new ValidationError(err);

    return true; // TODO: is there more to check?
  }

  static _checkAttachmentFieldsConsistent(doc: DocEs5): true | ValidationError {
    if (doc.text.length === 0 && doc.attachmentSize && doc.attachmentSize > 0) {
      return new ValidationError(
        "Documents with attachments must have text.",
      );
    }

    if (doc.text.length > 0 && doc.attachmentSize && doc.attachmentSize === 0) {
      "Documents with deleted attachments must have no text.";
    }

    if (doc.attachmentHash && doc.attachmentSize === undefined) {
      return new ValidationError(
        "Attachment size is undefined while attachment hash is defined",
      );
    }

    if (doc.attachmentSize && doc.attachmentHash === undefined) {
      return new ValidationError(
        "Attachment hash is undefined while attachment size is defined",
      );
    }

    return true;
  }

  static _checkAuthorCanWriteToPath(
    author: AuthorAddress,
    path: Path,
  ): true | ValidationError {
    // Can the author write to the path?
    // return a ValidationError, or return true on success.

    // no tilde: it's public, anyone can write
    if (path.indexOf("~") === -1) return true;
    // path contains "~" + author.  the author can write here.
    if (path.indexOf("~" + author) !== -1) return true;
    // else, path contains at least one tilde but not ~@author.  The author can't write here.
    return new ValidationError(
      `author ${author} can't write to path ${path}`,
    );
  }
  static _checkTimestampIsOk(
    timestamp: number,
    deleteAfter: number | null,
    now: number,
  ): true | ValidationError {
    // Check for valid timestamp, and expired ephemeral documents.
    // return a ValidationError, or return true on success.

    // timestamp and deleteAfter are already verified as good numbers by the schema checker:
    // - in the right range of min and max allowed timestamps
    // - integers, and not NaN or infinity

    // Timestamp must not be from the future.
    if (timestamp > now + FUTURE_CUTOFF_MICROSECONDS) {
      return new ValidationError("timestamp too far in the future");
    }

    // Ephemeral documents
    if (deleteAfter !== null) {
      // Only valid if expiration date is in the future
      if (now > deleteAfter) {
        return new ValidationError("ephemeral doc has expired");
      }
      // Can't expire before it was created, that makes no sense
      if (deleteAfter <= timestamp) {
        return new ValidationError(
          "ephemeral doc expired before it was created",
        );
      }
    }
    return true;
  }
  static _checkPathIsValid(
    path: Path,
    hasAttachment: boolean,
    deleteAfter?: number,
  ): true | ValidationError {
    // Ensure the path matches the spec for allowed path strings.
    //
    // Path validity depends on if the document is ephemeral or not.  To check
    // that rule, supply deleteAfter.  Omit deleteAfter to skip checking that rule
    // (e.g. to just check if a path is potentially valid, ephemeral or not).
    //
    // return a ValidationError, or return true on success.

    // A path is a series of one or more path segments.
    // A path segment is '/' followed by one or more allowed characters.

    // the schema already checked that this
    // - is a string
    // - length between 2 and 512 characters inclusive
    // - onlyHasChars(pathChars)

    if (!path.startsWith("/")) {
      return new ValidationError("invalid path: must start with /");
    }
    if (path.endsWith("/")) {
      return new ValidationError("invalid path: must not end with /");
    }
    if (path.startsWith("/@")) {
      // This is disallowed so that we can tell paths and authors apart
      // when joining a workspace and a path/author in a URL:
      // +gardening.xxxxx/@aaaa.xxxx
      // +gardening.xxxxx/wiki/shared/Bumblebee
      return new ValidationError(
        'invalid path: must not start with "/@"',
      );
    }
    if (path.indexOf("//") !== -1) {
      return new ValidationError(
        "invalid path: must not contain two consecutive slashes",
      );
    }

    if (deleteAfter !== undefined) {
      // path must contain at least one '!', if and only if the document is ephemeral
      if (path.indexOf("!") === -1 && deleteAfter !== null) {
        return new ValidationError(
          "when deleteAfter is set, path must contain '!'",
        );
      }
      if (path.indexOf("!") !== -1 && deleteAfter === null) {
        return new ValidationError(
          "when deleteAfter is null, path must not contain '!'",
        );
      }
    }

    // path must contain at least one '.', if and only if the document is a attachment
    if (path.indexOf(".") === -1 && hasAttachment) {
      return new ValidationError(
        "when a attachment is provided, path must contain '.'",
      );
    }
    if (path.indexOf(".") !== -1 && hasAttachment === false) {
      return new ValidationError(
        "when no attachment is provided, path must not contain '.'",
      );
    }

    return true;
  }
  static async _checkAuthorSignatureIsValid(
    doc: DocEs5,
  ): Promise<true | ValidationError> {
    // Check if the signature is good.
    // return a ValidationError, or return true on success.
    try {
      const hash = await this.hashDocument(doc);
      if (isErr(hash)) return hash;
      const verified = await Crypto.verify(doc.author, doc.signature, hash);
      if (verified !== true) {
        return new ValidationError("signature is invalid");
      }
      return true;
    } catch {
      return new ValidationError(
        "signature is invalid (unexpected exception)",
      );
    }
  }
  static async _checkContentMatchesHash(
    content: string,
    contentHash: Base32String,
  ): Promise<true | ValidationError> {
    // Ensure the contentHash matches the actual content.
    // return a ValidationError, or return true on success.

    // TODO: if content is null, skip this check
    if (await Crypto.sha256base32(content) !== contentHash) {
      return new ValidationError("content does not match contentHash");
    }
    return true;
  }

  static getAttachmentInfo(
    doc: DocEs5,
  ): { size: number; hash: string } | ValidationError {
    if (!doc.attachmentHash || !doc.attachmentSize) {
      return new ValidationError("This document has no attachment");
    }

    return {
      size: doc.attachmentSize,
      hash: doc.attachmentHash,
    };
  }

  static updateAttachmentFields(
    doc: DocEs5,
    size: number,
    hash: string,
  ): DocEs5 {
    return {
      ...doc,
      attachmentHash: hash,
      attachmentSize: size,
    };
  }
};
