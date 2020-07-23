import {
    AuthorAddress,
    AuthorKeypair,
    Document,
    FormatName,
    IValidator,
    Path,
} from '../util/types';
import {
    sha256,
    sign,
    verify,
} from '../crypto/crypto';
import {
    isOnlyPrintableAscii,
    onlyHasChars,
    pathChars,
} from '../util/characters';
import { parseAuthorAddress, parseWorkspaceAddress } from '../util/addresses';
import { logWarning } from '../util/log';

// this is always used as a static class
// e.g. just ValidatorEs4, not new ValidatorEs4()

export const ValidatorEs4 : IValidator = class {
    static format : FormatName = 'es.4';
    static pathIsValid(path: Path): boolean {
        // a path is a series of one or more path segments.
        // a path segment is a '/' followed by one or more allowed characters.

        if (!path.startsWith('/')) {
            logWarning('invalid path: does not start with /');
            return false;
        }
        if (path.endsWith('/')) {
            logWarning('invalid path: ends with /');
            return false;
        }
        if (path.startsWith('/@')) {
            // this is disallowed so that we can tell paths and authors apart in cases like this
            // when joining a workspace and a path/author:
            // +gardening.xxxxx/@aaaa.xxxx
            // +gardening.xxxxx/wiki/shared/Bumblebee
            logWarning('invalid path: starts with "/@"');
            return false;
        }
        if (path.indexOf('//') !== -1) {
            logWarning('invalid path: contains two consecutive slashes');
            return false;
        }
        if (!onlyHasChars(path, pathChars)) {
            logWarning('invalid path: contains disallowed characters');
            return false;
        }
        return true;
    }
    static authorCanWriteToPath(author: AuthorAddress, path: Path): boolean {
        // no tilde: it's public
        if (path.indexOf('~') === -1) {
            return true;
        }
        // path contains "~" + author.  the author can write here.
        if (path.indexOf('~' + author) !== -1) {
            return true;
        }
        // path contains at least one tilde but not ~@author.  The author can't write here.
        logWarning(`author ${author} can't write to path ${path}`);
        return false;
    }
    static hashDocument(doc: Document): string {
        // This is used for signatures and references to specific docs.
        // We use the hash of the content so we can drop the actual content
        // and only keep the hash around for verifying signatures,
        // though we're not using that ability yet.
        // None of these fields are allowed to contain newlines
        // except for content, but content is hashed, so it's safe to
        // use newlines as a field separator.
        // We enforce the no-newlines rules in documentIsValid() and pathIsValid().
        // If the document is especially malformed (wrong types or missing fields),
        // this will throw an error.

        if (!this._documentTypesAreValid(doc)) {
            throw new Error("document has invalid types");
        }

        return sha256([
            doc.format,
            doc.workspace,
            doc.path,
            sha256(doc.content),
            '' + doc.timestamp,
            doc.author,
        ].join('\n'));
    }
    static signDocument(keypair : AuthorKeypair, doc: Document): Document {
        return {
            ...doc,
            signature: sign(keypair, this.hashDocument(doc)),
        };
    }
    static documentSignatureIsValid(doc: Document): boolean {
        try {
            return verify(doc.author, doc.signature, this.hashDocument(doc));
        } catch (e) {
            return false;
        }
    }
    static _documentTypesAreValid(doc: Document): boolean {
        return (
               typeof doc.format === 'string'
            && typeof doc.workspace === 'string'
            && typeof doc.path === 'string'
            && typeof doc.content === 'string'
            && typeof doc.author === 'string'
            && typeof doc.timestamp === 'number'
            && typeof doc.signature === 'string'
        );
    }
    static documentIsValid(doc: Document, futureCutoff?: number): boolean {
        // "futureCutoff" is a time in microseconds (milliseconds * 1000).
        // If a message is from after futureCutoff, it's not valid.
        // It defaults to 10 minutes in the future.
        const FUTURE_CUTOFF_MINUTES = 10;
        futureCutoff = futureCutoff || (Date.now() + FUTURE_CUTOFF_MINUTES * 60 * 1000) * 1000;

        if (!this._documentTypesAreValid(doc)) {
            logWarning('documentIsValid: doc properties have wrong type(s)');
            return false;
        }

        // Don't allow extra properties in the object
        if (Object.keys(doc).length !== 7) {
            logWarning('documentIsValid: doc has extra properties');
            return false;
        }

        // doc.format should have already been checked by the store, when it decides
        // which validator to use.  But let's check it anyway.
        if (doc.format !== this.format) {
            logWarning('documentIsValid: format does not match validator');
            return false;
        }

        // TODO: size / length limits
        // Use Buffer.byteLength(string, 'utf8') to count bytes in a string.

        // Timestamps have to be in microseconds.
        // If the timestamp is small enough that it was probably
        // accidentally created with milliseconds or seconds,
        // the message is invalid.
        if (doc.timestamp <= 9999999999999) {
            logWarning('documentIsValid: timestamp too small');
            return false;
        }
        // Timestamp must be less than Number.MAX_SAFE_INTEGER.
        if (doc.timestamp > 9007199254740991) {
            logWarning('documentIsValid: timestamp too large');
            return false;
        }
        // Timestamp must not be from the future.
        if (doc.timestamp > futureCutoff) {
            logWarning('documentIsValid: timestamp is in the future');
            return false;
        }

        // No non-printable ascii characters or unicode (except doc.content)
        // (the format is caught earlier by checking if doc.format === this.format)
        /* istanbul ignore next */
        if (!isOnlyPrintableAscii(doc.format)) {
            logWarning('documentIsValid: format contains non-printable ascii characters');
            return false;
        }
        if (!isOnlyPrintableAscii(doc.workspace)) {
            logWarning('documentIsValid: workspace contains non-printable ascii characters');
            return false;
        }
        if (!isOnlyPrintableAscii(doc.author)) {
            logWarning('documentIsValid: author contains non-printable ascii characters');
            return false;
        }
        if (!isOnlyPrintableAscii(doc.signature)) {
            logWarning('documentIsValid: signature contains non-printable ascii characters');
            return false;
        }

        // doc.content can be any unicode string.

        // Path must be valid (only printable ascii, etc)
        if (!this.pathIsValid(doc.path)) {
            logWarning('documentIsValid: path not valid');
            return false;
        }

        // Author must be parsable (start with '@', etc)
        let {authorParsed, err} = parseAuthorAddress(doc.author);
        if (err || authorParsed === null) {
            logWarning('documentIsValid: author could not be parsed: ' + err);
            return false;
        }

        // Workspace must be parsable (start with '//', etc)
        let {workspaceParsed, err: err2} = parseWorkspaceAddress(doc.workspace);
        if (err2 || workspaceParsed === null) {
            logWarning('documentIsValid: workspace could not be parsed: ' + err2);
            return false;
        }

        // Author must have write permission
        if (!this.authorCanWriteToPath(doc.author, doc.path)) {
            logWarning('documentIsValid: author can\'t write to path');
            return false;
        }

        // Check signature last since it's slow and all the above checks
        // are simple and safe enough to do on untrusted data.
        if (!this.documentSignatureIsValid(doc)) {
            logWarning('documentIsValid: invalid signature');
            return false;
        }

        return true;
    }
}
