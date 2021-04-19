import {
    AuthorAddress,
    AuthorKeypair,
    AuthorParsed,
    Base32String,
    Doc,
    FormatName,
    Path,
    WorkspaceAddress,
    WorkspaceParsed,
} from './docTypes';
import { ValidationError } from '../util/errors';


/**
 * Validators are each responsible for one document format such as "es.4".
 * They are used by Storage instances to
 * * check if documents are valid before accepting them
 * * sign new documents
 *
 * According to the rules of Earthstar: documents are validated statelessly,
 * one document at a time, without knowing about any other documents
 * or what's in the Storage.
 *
 * These are all static methods.
 * You won't be making instances of Validators because they have no state.
 * They're just a collection of functions.
 */
export interface IDocValidator {
    /** The string name of the format, like "es.4" */
    format: FormatName;

    /** Deterministic hash of this version of the document */
    hashDocument(doc: Doc): Base32String | ValidationError;

    /**
     * Add an author signature to the document.
     * The input document needs a signature field to satisfy Typescript, but
     * it will be overwritten here, so you may as well just set signature: '' on the input.
     */
    signDocument(keypair: AuthorKeypair, doc: Doc): Doc | ValidationError;

    /**
     * This calls all the more detailed functions which start with underscores.
     * Returns true if the document is ok.
     */
    checkDocumentIsValid(doc: Doc, now?: number): true | ValidationError;

    // These are broken out for easier unit testing.
    // They will not normally be used directly; use the main assertDocumentIsValid instead.
    // Return true on success.
    _checkBasicDocumentValidity(doc: Doc): true | ValidationError;  // check for correct fields and datatypes
    _checkAuthorCanWriteToPath(author: AuthorAddress, path: Path): true | ValidationError;
    _checkTimestampIsOk(timestamp: number, deleteAfter: number | null, now: number): true | ValidationError;
    _checkPathIsValid(path: Path, deleteAfter?: number | null): true | ValidationError;
    _checkAuthorSignatureIsValid(doc: Doc): true | ValidationError;
    _checkContentMatchesHash(content: string, contentHash: Base32String): true | ValidationError;

    // TODO: add these methods for building addresses
    // and remove them from crypto.ts and encoding.ts
    // assembleWorkspaceAddress = (name : WorkspaceName, encodedPubkey : EncodedKey) : WorkspaceAddress
    // assembleAuthorAddress = (shortname : AuthorShortname, encodedPubkey : EncodedKey) : AuthorAddress
}
