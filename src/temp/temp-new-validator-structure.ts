import {
    AuthorAddress,
    AuthorKeypair,
    AuthorParsed,
    Document,
    FormatName,
    Path,
    ValidationError,
    WorkspaceAddress,
    WorkspaceParsed,
} from '../util/types';

// these are always used as a static class
// e.g. just ValidatorEs4, not new ValidatorEs4()

// anything in this file called "assertXxxx"
// returns nothing on success, and throws a ValidationError on failure, explaining why.

export let assertBasicDocumentValidity = (doc: Document, now?: number): void => {
}

export interface IFormat {
    format: FormatName;
    hashDocument(doc: Document): string;
    signDocument(keypair: AuthorKeypair, doc: Document): Document;

    // this calls assertBasicDocumentValidity
    // and all the following more detailed functions
    assertDocumentIsValid(doc: Document, now?: number): void;

    _assertAuthorCanWriteToPath(author: AuthorAddress, path: Path): void;
    _assertTimeChecks(timestamp: number, deleteAfter: number | null, now: number): void;
    _assertPathIsWellFormed(path: Path): void;
    _assertAuthorIsWellFormed(authorAddress: AuthorAddress): void;
    _assertWorkspaceIsWellFormed(workspaceAddress: WorkspaceAddress): void;
    _assertAuthorSignatureIsValid(doc: Document): void;
}

export interface IFormatES4 extends IFormat {
    format: 'es.4';

    // can throw ValidationErrors
    parseAuthorAddress(addr : AuthorAddress) : AuthorParsed;
    parseWorkspaceAddress(addr : WorkspaceAddress) : WorkspaceParsed;
}
