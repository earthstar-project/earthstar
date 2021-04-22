import {
    AuthorAddress,
    AuthorKeypair,
    Base32String,
    Doc,
    Path,
} from '../util/doc-types';
import {
    isErr,
    ValidationError
} from '../util/errors';
import {
    IFormatValidator
} from './format-validator-types';

import {
    authorAddressChars,
    b32chars,
    pathChars,
    workspaceAddressChars,
} from '../core-validators/characters';
import {
    checkInt,
    checkLiteral,
    checkObj,
    CheckObjOpts,
    checkString,
} from '../core-validators/checkers';
import {
    parseAuthorAddress,
    parseWorkspaceAddress
} from '../core-validators/addresses';

import { 
    sha256base32,
    sign,
    verify,
} from '../crypto/crypto';

//================================================================================

// Tolerance for accepting messages from the future (because of clock skew between peers)
const FUTURE_CUTOFF_MINUTES = 10;
const FUTURE_CUTOFF_MICROSECONDS = FUTURE_CUTOFF_MINUTES * 60 * 1000 * 1000;

// Allowed valid range of timestamps (in microseconds, not milliseconds)
const MIN_TIMESTAMP = 10000000000000;  // 10^13
const MAX_TIMESTAMP = 9007199254740990;  // Number.MAX_SAFE_INTEGER - 1

const HASH_STR_LEN = 53;  // number of base32 characters including leading 'b', which is 32 raw bytes when decoded
const SIG_STR_LEN = 104;  // number of base32 characters including leading 'b', which is 64 raw bytes when decoded

const ES4_SCHEMA: CheckObjOpts = {
    objSchema: {
        format: checkLiteral('es.4'),
        author: checkString({ allowedChars: authorAddressChars }),
        content: checkString(),
        contentHash: checkString({ allowedChars: b32chars, len: HASH_STR_LEN }),
        path: checkString({ allowedChars: pathChars, minLen: 2, maxLen: 512 }),
        signature: checkString({ allowedChars: b32chars, len: SIG_STR_LEN }),
        timestamp: checkInt({ min: MIN_TIMESTAMP, max: MAX_TIMESTAMP }),
        workspace: checkString({ allowedChars: workspaceAddressChars }),
    },
    allowUndefined: false,
    allowExtraKeys: false,
}

// This is always used as a static class
// e.g. just `FormatValidatorEs4`, not `new FormatValidatorEs4()`
export const FormatValidatorEs4: IFormatValidator = class {
    static format: 'es.4' = 'es.4';

    /** Deterministic hash of this version of the document */
    static hashDocument(doc: Doc): Base32String | ValidationError {
        // Deterministic hash of the document.
        // Can return a ValidationError, but only checks for very basic document validity.

        // The hash of the document is used for signatures and references to specific docs.
        // We use the hash of the content in case we want to drop the actual content
        // and only keep the hash around for verifying signatures.
        // None of these fields are allowed to contain tabs or newlines
        // (except content, but we use contentHash instead).

        let err = this._checkBasicDocumentValidity(doc);
        if (isErr(err)) { return err; }

        // Sort fields in lexicographic order by field name.
        // let result = ''
        // For each field,
        //     skip "content" and "signature" fields.
        //     skip fields with value === null.
        //     result += fieldname + "\t" + convertToString(value) + "\n"
        // return base32encode(sha256(result).binaryDigest())
        return sha256base32(
            `author\t${doc.author}\n` +
            `contentHash\t${doc.contentHash}\n` +
            (doc.deleteAfter === null ? '' : `deleteAfter\t${doc.deleteAfter}\n`) +
            `format\t${doc.format}\n` +
            `path\t${doc.path}\n` +
            `timestamp\t${doc.timestamp}\n` +
            `workspace\t${doc.workspace}\n`  // \n at the end also, not just between
        );
    }

    /**
     * Add an author signature to the document.
     * The input document needs a signature field to satisfy Typescript, but
     * it will be overwritten here, so you may as well just set signature: '' on the input.
     * Return a copy of the original document with the signature field changed, or return a ValidationError.
     */
    static signDocument(keypair: AuthorKeypair, doc: Doc): Doc | ValidationError {
        if (keypair.address !== doc.author) {
            return new ValidationError('when signing a document, keypair address must match document author');
        }

        let hash = this.hashDocument(doc);
        if (isErr(hash)) { return hash; }

        let sig = sign(keypair, hash);
        if (isErr(sig)) { return sig; }

        return { ...doc, signature: sig };
    }

    /**
     * This calls all the more detailed functions which start with underscores.
     * Returns true if the document is ok, or returns a ValidationError if anything is wrong.
     * Normally `now` should be omitted so that it defaults to the current time,
     * or you can override it for testing purposes.
     */
    static checkDocumentIsValid(doc: Doc, now?: number): true | ValidationError {
        if (now === undefined) { now = Date.now() * 1000; }
        // do this first to ensure we have all the right datatypes in the right fields
        let errBV = this._checkBasicDocumentValidity(doc);
        if (isErr(errBV)) { return errBV; }

        // this is the most likely to fail under regular conditions, so do it next
        // (because of clock skew and expired ephemeral documents)
        let errT = this._checkTimestampIsOk(doc.timestamp, doc.deleteAfter, now);
        if (isErr(errT)) { return errT; }

        let errW = this._checkAuthorCanWriteToPath(doc.author, doc.path);
        if (isErr(errW)) { return errW; }

        let errP = this._checkPathIsValid(doc.path, doc.deleteAfter);
        if (isErr(errP)) { return errP; }

        let errAA = parseAuthorAddress(doc.author);
        if (isErr(errAA)) { return errAA; }

        let errWA = parseWorkspaceAddress(doc.workspace);
        if (isErr(errWA)) { return errWA; }

        // do this after validating that the author address is well-formed
        // so we don't pass garbage into the crypto signature code
        let errS = this._checkAuthorSignatureIsValid(doc);
        if (isErr(errS)) { return errS; }

        // do this last since it might be slow on a large document
        let errCH = this._checkContentMatchesHash(doc.content, doc.contentHash);
        if (isErr(errCH)) { return errCH; }
        return true;
    }

    // These are broken out for easier unit testing.
    // They will not normally be used directly; use the main assertDocumentIsValid instead.
    // Return true on success.
    static _checkBasicDocumentValidity(doc: Doc): true | ValidationError {  // check for correct fields and datatypes
        let err = checkObj(ES4_SCHEMA)(doc);
        if (err !== null) { return new ValidationError(err); }
        return true; // TODO: is there more to check?
    }
    static _checkAuthorCanWriteToPath(author: AuthorAddress, path: Path): true | ValidationError {
        // Can the author write to the path?
        // return a ValidationError, or return true on success.

        // no tilde: it's public, anyone can write
        if (path.indexOf('~') === -1) { return true; }
        // path contains "~" + author.  the author can write here.
        if (path.indexOf('~' + author) !== -1) { return true; }
        // else, path contains at least one tilde but not ~@author.  The author can't write here.
        return new ValidationError(`author ${author} can't write to path ${path}`);
    }
    static _checkTimestampIsOk(timestamp: number, deleteAfter: number | null, now: number): true | ValidationError {
        // Check for valid timestamp, and expired ephemeral documents.
        // return a ValidationError, or return true on success.

        // timestamp and deleteAfter are already verified as good numbers by the schema checker:
        // - in the right range of min and max allowed timestamps
        // - integers, and not NaN or infinity

        // Timestamp must not be from the future.
        if (timestamp > now + FUTURE_CUTOFF_MICROSECONDS) {
            return new ValidationError('timestamp too far in the future');
        }

        // Ephemeral documents
        if (deleteAfter !== null) {
            // Only valid if expiration date is in the future
            if (now > deleteAfter) {
                return new ValidationError('ephemeral doc has expired');
            }
            // Can't expire before it was created, that makes no sense
            if (deleteAfter <= timestamp) {
                return new ValidationError('ephemeral doc expired before it was created');
            }
        }
        return true;
    }
    static _checkPathIsValid(path: Path, deleteAfter?: number | null): true | ValidationError {
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

        if (!path.startsWith('/')) {
            return new ValidationError('invalid path: must start with /');
        }
        if (path.endsWith('/')) {
            return new ValidationError('invalid path: must not end with /');
        }
        if (path.startsWith('/@')) {
            // This is disallowed so that we can tell paths and authors apart
            // when joining a workspace and a path/author in a URL:
            // +gardening.xxxxx/@aaaa.xxxx
            // +gardening.xxxxx/wiki/shared/Bumblebee
            return new ValidationError('invalid path: must not start with "/@"');
        }
        if (path.indexOf('//') !== -1) {
            return new ValidationError('invalid path: must not contain two consecutive slashes');
        }

        if (deleteAfter !== undefined) {
            // path must contain at least one '!', if and only if the document is ephemeral
            if (path.indexOf('!') === -1 && deleteAfter !== null) {
                return new ValidationError("when deleteAfter is set, path must contain '!'");
            }
            if (path.indexOf('!') !== -1 && deleteAfter === null) {
                return new ValidationError("when deleteAfter is null, path must not contain '!'");
            }
        }

        return true;
    }
    static _checkAuthorSignatureIsValid(doc: Doc): true | ValidationError {
        // Check if the signature is good.
        // return a ValidationError, or return true on success.
        try {
            let hash = this.hashDocument(doc);
            if (isErr(hash)) { return hash; }
            let verified = verify(doc.author, doc.signature, hash);
            if (verified !== true) { return new ValidationError('signature is invalid'); }
            return true;
        } catch (err) {
            return new ValidationError('signature is invalid (unexpected exception)');
        }
    }
    static _checkContentMatchesHash(content: string, contentHash: Base32String): true | ValidationError {
        // Ensure the contentHash matches the actual content.
        // return a ValidationError, or return true on success.

        // TODO: if content is null, skip this check
        if (sha256base32(content) !== contentHash) {
            return new ValidationError('content does not match contentHash');
        }
        return true;
    }
}

