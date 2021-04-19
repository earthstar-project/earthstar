import {
    AuthorAddress,
    AuthorKeypair,
    AuthorParsed,
    Base32String,
    Doc,
    Path,
    WorkspaceAddress,
    WorkspaceParsed,
} from '../types/docTypes';
import { ValidationError } from '../util/errors';
import { IValidatorES4 } from '../types/validatorTypes';
import { 
    sign,
    verify,
    sha256base32,
} from '../crypto/crypto';

// This is always used as a static class
// e.g. just `ValidatorEs4`, not `new ValidatorEs4()`
export const ValidatorEs4: IValidatorES4 = class {
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
        return new ValidationError('not implemented yet');
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
    static _checkAuthorIsValid(authorAddress: AuthorAddress): true | ValidationError {
        return new ValidationError('not implemented yet');
    }
    static _checkWorkspaceIsValid(workspaceAddress: WorkspaceAddress): true | ValidationError {
        return new ValidationError('not implemented yet');
    }
    static _checkAuthorSignatureIsValid(doc: Doc): true | ValidationError {
        return new ValidationError('not implemented yet');
    }
    static _checkContentMatchesHash(content: string, contentHash: Base32String): true | ValidationError {
        return new ValidationError('not implemented yet');
    }

    /** Parse an author address into its parts. */
    static parseAuthorAddress(addr : AuthorAddress) : AuthorParsed | ValidationError {
        return new ValidationError('not implemented yet');
    }

    /** Parse a workspace address into its parts. */
    static parseWorkspaceAddress(addr : WorkspaceAddress) : WorkspaceParsed | ValidationError {
        return new ValidationError('not implemented yet');
    }

    // TODO: add these methods for building addresses
    // and remove them from crypto.ts and encoding.ts
    // assembleWorkspaceAddress = (name : WorkspaceName, encodedPubkey : EncodedKey) : WorkspaceAddress
    // assembleAuthorAddress = (shortname : AuthorShortname, encodedPubkey : EncodedKey) : AuthorAddress
}

