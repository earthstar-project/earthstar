import {
    AuthorAddress,
    AuthorKeypair,
    Base32String,
    Doc,
    Path,
} from '../types/doc-types';
import {
    IFormatValidator
} from '../types/format-validator-types';
import {
    ValidationError
} from '../util/errors';

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
    sign,
    verify,
    sha256base32,
} from '../crypto/crypto';

//================================================================================

let MIN_TIMESTAMP = 10000000000000;  // 10^13
let MAX_TIMESTAMP = 9007199254740990;  // Number.MAX_SAFE_INTEGER - 1

let HASH_STR_LEN = 53;  // including leading 'b'
let SIG_STR_LEN = 104;  // including leading 'b'

let ES4_SCHEMA: CheckObjOpts = {
    objSchema: {
        format: checkLiteral('es.4'),
        author: checkString({ allowedChars: authorAddressChars }),
        content: checkString(),
        contentHash: checkString({ allowedChars: b32chars, len: HASH_STR_LEN }),
        contentLength: checkInt({ min: 0 }),
        path: checkString({ allowedChars: pathChars }),
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
    static format: 'es.4';

    /** Deterministic hash of this version of the document */
    static hashDocument(doc: Doc): Base32String | ValidationError {
        return new ValidationError('not implemented yet');
    }

    /**
     * Add an author signature to the document.
     * The input document needs a signature field to satisfy Typescript, but
     * it will be overwritten here, so you may as well just set signature: '' on the input.
     * Return the original document (mutated) or return a ValidationError.
     */
    static signDocument(keypair: AuthorKeypair, doc: Doc): Doc | ValidationError {
        // HACK - not implemented yet
        doc.signature = 'fakesignature:' + Math.random();
        return doc
    }

    /**
     * This calls all the more detailed functions which start with underscores.
     * Returns true if the document is ok.
     */
    static checkDocumentIsValid(doc: Doc, now?: number): true | ValidationError {
        // HACK - not implemented yet
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
        return new ValidationError('not implemented yet');
    }
    static _checkTimestampIsOk(timestamp: number, deleteAfter: number | null, now: number): true | ValidationError {
        return new ValidationError('not implemented yet');
    }
    static _checkPathIsValid(path: Path, deleteAfter?: number | null): true | ValidationError {
        return new ValidationError('not implemented yet');
    }
    static _checkAuthorSignatureIsValid(doc: Doc): true | ValidationError {
        return new ValidationError('not implemented yet');
    }
    static _checkContentMatchesHash(content: string, contentHash: Base32String): true | ValidationError {
        if (sha256base32(content) !== contentHash) {
            return new ValidationError('content does not match contentHash');
        }
        return true;
    }
}

