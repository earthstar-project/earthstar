import { deepEqual } from 'fast-equals';

import {
    AuthorAddress,
    AuthorKeypair,
    AuthorParsed,
    Document,
    EncodedHash,
    IValidatorNew_ES4,
    Path,
    ValidationError,
    WorkspaceAddress,
    WorkspaceParsed,
} from '../util/types';
import {
    sha256,
    sign,
    verify,
} from '../crypto/crypto';
import {
    alphaLower,
    authorAddressChars,
    authorShortnameChars,
    b32chars,
    digits,
    isOnlyPrintableAscii,
    onlyHasChars,
    pathChars,
    workspaceNameChars,
    workspaceAddressChars,
} from '../util/characters';

// Tolerance for accepting messages from the future (because of clock skew between peers)
export const FUTURE_CUTOFF_MINUTES = 10;
export const FUTURE_CUTOFF_MICROSECONDS = FUTURE_CUTOFF_MINUTES * 60 * 1000 * 1000;

// This is always used as a static class
// e.g. just `ValidatorEs4`, not `new ValidatorEs4()`

// Methods called "assert_____" return nothing on success, and throw a ValidationError on failure.

export const ValidatorNew_Es4 : IValidatorNew_ES4 = class {
    static format: 'es.4' = 'es.4';
    static hashDocument(doc: Document): EncodedHash {
        // Deterministic hash of the document.
        // Can throw a ValidationError, but only checks for very basic document validity.

        // The hash of the document is used for signatures and references to specific docs.
        // We use the hash of the content in case we want to drop the actual content
        // and only keep the hash around for verifying signatures.
        // None of these fields are allowed to contain newlines
        // except for content, but content is hashed, so it's safe to
        // use newlines as a field separator.

        // If the document is especially malformed (wrong types or missing fields), throw an error.
        this._assertBasicDocumentValidity(doc);

        // Fields in alphabetical order.
        // Convert numbers to strings.
        // Replace optional properties with '' if they're missing.
        // Use the contentHash instead of the content.
        return sha256([
            doc.author,
            doc.contentHash,
            doc.deleteAfter === undefined ? '' : '' + doc.deleteAfter,
            doc.format,
            doc.path,
            '' + doc.timestamp,
            doc.workspace,
        ].join('\n'));
    }
    static signDocument(keypair: AuthorKeypair, doc: Document): Document {
        // Add an author signature to the document.
        // The input document needs a signature field to satisfy Typescript, but
        // it will be overwritten here, so you may as well just set signature: '' on the input
        // Can throw a ValidationError (via hashDocument), but only checks for very basic document validity.

        return {
            ...doc,
            signature: sign(keypair, this.hashDocument(doc)),
        };
    }
    static assertDocumentIsValid(doc: Document, now?: number): void {
        // Throw a ValidationError if anything is wrong with the document.
        // Normally `now` should be omitted so that it defaults to the current time,
        // or you can override it for testing purposes.

        if (now === undefined) { now = Date.now() * 1000; }
        this._assertBasicDocumentValidity(doc);
        this._assertAuthorCanWriteToPath(doc.author, doc.path);
        this._assertTimestampIsOk(doc.timestamp, doc.deleteAfter, now);
        this._assertPathIsValid(doc.path);
        this._assertAuthorIsValid(doc.author);
        this._assertWorkspaceIsValid(doc.workspace);
        this._assertAuthorSignatureIsValid(doc);
        this._assertContentMatchesHash(doc.content, doc.contentHash);
    }

    static _assertBasicDocumentValidity(doc: Document): void {
        // Check that the document has only the expected properties
        // and that they have the expected data types.
        // Throw a ValidationError, or return nothing on success.

        if (doc.format !== this.format) {
            throw new ValidationError('invalid format: ' + doc.format);
        }

        let validTypes = (
               typeof doc.format === 'string'
            && typeof doc.workspace === 'string'
            && typeof doc.path === 'string'
            && typeof doc.contentHash === 'string'
            && typeof doc.content === 'string'  // TODO: or null
            && typeof doc.author === 'string'
            && typeof doc.timestamp === 'number'
            && ("deleteAfter" in doc === false || typeof doc.deleteAfter === 'number')
            && typeof doc.signature === 'string'
        );
        if (!validTypes) { throw new ValidationError('invalid types or missing fields in document'); }

        // Don't allow extra properties in the object
        let keys = Object.keys(doc);
        if (keys.indexOf('deleteAfter') === -1) { keys.push('deleteAfter'); }
        keys.sort();
        if (!deepEqual(keys, [
            'author',
            'content',
            'contentHash',
            'deleteAfter',
            'format',
            'path',
            'signature',
            'timestamp',
            'workspace',
        ])) {
            throw new ValidationError('doc has extra fields');
        }

        // TODO: string length limits
    }
    static _assertAuthorCanWriteToPath(author: AuthorAddress, path: Path): void {
        // Can the author write to the path?
        // Throw a ValidationError, or return nothing on success.

        // no tilde: it's public, anyone can write
        if (path.indexOf('~') === -1) { return; }
        // path contains "~" + author.  the author can write here.
        if (path.indexOf('~' + author) !== -1) { return; }
        // else, path contains at least one tilde but not ~@author.  The author can't write here.
        throw new ValidationError(`author ${author} can't write to path ${path}`);
    }
    static _assertTimestampIsOk(timestamp: number, deleteAfter: number | undefined, now: number): void {
        // Check for valid timestamp, and expired ephemeral documents.
        // Throw a ValidationError, or return nothing on success.

        // Timestamps have to be in microseconds.
        // If the timestamp is small enough that it was probably
        // accidentally created with milliseconds or seconds,
        // the message is invalid.

        // TODO: all these checks need to apply to deleteAfter also

        if (typeof timestamp !== 'number' || timestamp !== Math.floor(timestamp)) {
            throw new ValidationError('timestamp must be an integer');
        }
        if (isNaN(timestamp)) {
            throw new ValidationError("timestamp can't be NaN");
        }

        if (timestamp <= 9999999999999) {
            throw new ValidationError('timestamp less than minimum allowed value');
        }
        // Timestamp must be less than Number.MAX_SAFE_INTEGER.
        if (timestamp > 9007199254740991) {
            throw new ValidationError('timestamp greater than maximum allowed value');
        }
        // Timestamp must not be from the future.
        if (timestamp > now + FUTURE_CUTOFF_MICROSECONDS) {
            throw new ValidationError('timestamp too far in the future');
        }
        // Ephemeral documents
        if (deleteAfter !== undefined) {
            // basic checks
            if (typeof deleteAfter !== 'number' || deleteAfter !== Math.floor(deleteAfter)) {
                throw new ValidationError('deleteAfter must be an integer');
            }
            if (isNaN(deleteAfter)) {
                throw new ValidationError("deleteAfter can't be NaN");
            }

            if (deleteAfter <= 9999999999999) {
                throw new ValidationError('deleteAfter less than minimum allowed value');
            }
            // Timestamp must be less than Number.MAX_SAFE_INTEGER.
            if (deleteAfter > 9007199254740991) {
                throw new ValidationError('deleteAfter greater than maximum allowed value');
            }
            // Expiration date has passed
            if (now > deleteAfter) {
                throw new ValidationError('ephemeral doc has expired');
            }
            // Expired before it was created??
            if (deleteAfter <= timestamp) {
                throw new ValidationError('ephemeral doc expired before it was created');
            }
        }
    }
    static _assertPathIsValid(path: Path): void {
        // Ensure the path matches the spec for allowed path strings.
        // Throw a ValidationError, or return nothing on success.

        // a path is a series of one or more path segments.
        // a path segment is a '/' followed by one or more allowed characters.

        if (!path.startsWith('/')) {
            throw new ValidationError('invalid path: must start with /');
        }
        if (path.endsWith('/')) {
            throw new ValidationError('invalid path: must not end with /');
        }
        if (path.startsWith('/@')) {
            // this is disallowed so that we can tell paths and authors apart in cases like this
            // when joining a workspace and a path/author:
            // +gardening.xxxxx/@aaaa.xxxx
            // +gardening.xxxxx/wiki/shared/Bumblebee
            throw new ValidationError('invalid path: must not start with "/@"');
        }
        if (path.indexOf('//') !== -1) {
            throw new ValidationError('invalid path: must not contain two consecutive slashes');
        }
        if (!onlyHasChars(path, pathChars)) {
            throw new ValidationError('invalid path: must not contain disallowed characters');
        }
    }
    static _assertAuthorIsValid(authorAddress: AuthorAddress): void {
        // Ensure the author address matches the spec.
        // Throw a ValidationError, or return nothing on success.
        this.parseAuthorAddress(authorAddress);
    }
    static _assertWorkspaceIsValid(workspaceAddress: WorkspaceAddress): void {
        // Ensure the workspace address matches the spec.
        // Throw a ValidationError, or return nothing on success.
        this.parseWorkspaceAddress(workspaceAddress);
    }
    static _assertAuthorSignatureIsValid(doc: Document): void {
        // Check if the signature is good.
        // Throw a ValidationError, or return nothing on success.
        try {
            verify(doc.author, doc.signature, this.hashDocument(doc));
        } catch (e) {
            throw new ValidationError('signature is invalid');
        }
    }
    static _assertContentMatchesHash(content: string, contentHash: EncodedHash): void {
        // Ensure the contentHash matches the actual content.
        // Throw a ValidationError, or return nothing on success.

        // TODO: if content is null, skip this check
        let shaContent = sha256(content);
        if (contentHash !== shaContent) {
            throw new ValidationError(`content does not match contentHash.  sha256(content) is ${shaContent} but contentHash is ${contentHash}`);
        }
    }

    static parseAuthorAddress(addr : AuthorAddress) : AuthorParsed {
        // Break apart the address into its parts.
        // Can throw a ValidationError if the address is not valid.

        // example: @suzy.b2hd23dh....
        if (!isOnlyPrintableAscii(addr)) {
            throw new ValidationError(`author address ${JSON.stringify(addr)} must not have nonprintable or non-ASCII characters`);
        }
        if (!addr.startsWith('@')) {
            throw new ValidationError(`author address ${JSON.stringify(addr)} must start with "@"`);
        }
        if (!onlyHasChars(addr, authorAddressChars)) {
            throw new ValidationError(`author address ${JSON.stringify(addr)} must not use disallowed characters`);
        }
        let parts = addr.slice(1).split('.');
        if (parts.length !== 2) {
            throw new ValidationError(`author address ${JSON.stringify(addr)} must be two parts separated by "."`);
        }
        let [shortname, pubkey] = parts;
        if (shortname.length !== 4) {
            throw new ValidationError(`author shortname ${JSON.stringify(shortname)} must be 4 characters long`);
        }
        if (pubkey.length !== 53) {
            // 53 chars including the leading 'b' == 52 chars of actual base32 data
            throw new ValidationError(`author pubkey ${JSON.stringify(pubkey)} must be 53 characters long`);
        }
        if (pubkey[0] !== 'b') {
            throw new ValidationError(`author pubkey ${JSON.stringify(pubkey)} must start with 'b'`);
        }
        if (digits.indexOf(shortname[0]) !== -1) {
            throw new ValidationError(`author shortname ${JSON.stringify(shortname)} must not start with a number`);
        }
        if (digits.indexOf(pubkey[0]) !== -1) {
            throw new ValidationError(`author pubkey ${JSON.stringify(pubkey)} must not start with a number`);
        }
        if (!onlyHasChars(shortname, authorShortnameChars)) {
            throw new ValidationError(`author shortname ${JSON.stringify(shortname)} must not use disallowed characters`);
        }
        if (!onlyHasChars(pubkey, b32chars)) {
            throw new ValidationError(`author pubkey ${JSON.stringify(pubkey)} must not use disallowed characters`);
        }
        return {
            address: addr,
            shortname: shortname,
            pubkey: pubkey,
        };
    }
    static parseWorkspaceAddress(addr : WorkspaceAddress) : WorkspaceParsed {
        // Break apart the address into its parts.
        // Can throw a ValidationError if the address is not valid.

        // example unlisted workspace:                  +solarpunk.anythinghere
        // example invite-only (53 chars of pubkey):    +solarpunk.b2ojhodi3...
        if (!isOnlyPrintableAscii(addr)) {
            throw new ValidationError(`workspace address ${JSON.stringify(addr)} must not have nonprintable or non-ASCII characters`);
        }
        if (!addr.startsWith('+')) {
            throw new ValidationError(`workspace address ${JSON.stringify(addr)} must start with "+"`);
        }
        if (!onlyHasChars(addr, workspaceAddressChars)) {
            throw new ValidationError(`workspace address ${JSON.stringify(addr)} must not use disallowed characters`);
        }
        let parts = addr.slice(1).split('.');
        if (parts.length !== 2) {
            throw new ValidationError(`workspace address ${JSON.stringify(addr)} must be two parts separated by "."`);
        }
        let [name, pubkey] = parts;
        if (name.length < 1 || name.length > 15) {
            throw new ValidationError(`workspace name ${JSON.stringify(name)} must be between 1 and 15 characters long`);
        }
        if (pubkey.length < 1 || pubkey.length > 53) {
            throw new ValidationError(`workspace key ${JSON.stringify(pubkey)} must be between 1 and 53 characters long`);
        }
        if (digits.indexOf(name[0]) !== -1) {
            throw new ValidationError(`workspace name ${JSON.stringify(name)} must not start with a number`);
        }
        if (digits.indexOf(pubkey[0]) !== -1) {
            throw new ValidationError(`workspace key ${JSON.stringify(pubkey)} must not start with a number`);
        }
        if (!onlyHasChars(name, workspaceNameChars)) {
            throw new ValidationError(`workspace name ${JSON.stringify(name)} must not use disallowed characters`);
        }
        if (!onlyHasChars(pubkey, alphaLower + digits)) {
            throw new ValidationError(`workspace key ${JSON.stringify(pubkey)} must not use disallowed characters`);
        }
        return {
            address: addr,
            name: name,
            pubkey: pubkey,
        };
    }
}
