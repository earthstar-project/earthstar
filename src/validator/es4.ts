import { deepEqual } from 'fast-equals';

import {
    AuthorAddress,
    AuthorKeypair,
    AuthorParsed,
    Document,
    EncodedHash,
    IValidatorES4,
    Path,
    ValidationError,
    WorkspaceAddress,
    WorkspaceParsed,
    isErr,
} from '../util/types';
import {
    sha256base32,
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
    workspaceAddressChars,
    workspaceNameChars,
} from '../util/characters';
import { isPlainObject } from '../util/helpers';

// Tolerance for accepting messages from the future (because of clock skew between peers)
export const FUTURE_CUTOFF_MINUTES = 10;
export const FUTURE_CUTOFF_MICROSECONDS = FUTURE_CUTOFF_MINUTES * 60 * 1000 * 1000;

let isInt = (n : number) : boolean =>
    typeof n === 'number' && !isNaN(n) && n === Math.floor(n);

let isIntOrNull = (n : number | null) : boolean =>
    n === null || isInt(n)

// This is always used as a static class
// e.g. just `ValidatorEs4`, not `new ValidatorEs4()`
export const ValidatorEs4 : IValidatorES4 = class {
    static format: 'es.4' = 'es.4';
    static hashDocument(doc: Document): EncodedHash | ValidationError {
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
    static signDocument(keypair: AuthorKeypair, doc: Document): Document | ValidationError {
        // Add an author signature to the document.
        // The input document needs a signature field to satisfy Typescript, but
        // it will be overwritten here, so you may as well just set signature: '' on the input
        // Can return a ValidationError (via hashDocument), but only checks for very basic document validity.

        if (keypair.address !== doc.author) {
            return new ValidationError('when signing a document, keypair address must match document author');
        }

        let hash = this.hashDocument(doc);
        if (isErr(hash)) { return hash; }

        let sig = sign(keypair, hash);
        if (isErr(sig)) { return sig; }

        return { ...doc, signature: sig };
    }
    static checkDocumentIsValid(doc: Document, now?: number): true | ValidationError {
        // Return a ValidationError if anything is wrong with the document, or true if it's ok.
        // Normally `now` should be omitted so that it defaults to the current time,
        // or you can override it for testing purposes.
        if (now === undefined) { now = Date.now() * 1000; }
        let err1 = this._checkBasicDocumentValidity(doc);
        if (isErr(err1)) { return err1; }
        let err2 = this._checkAuthorCanWriteToPath(doc.author, doc.path);
        if (isErr(err2)) { return err2; }
        let err3 = this._checkTimestampIsOk(doc.timestamp, doc.deleteAfter, now);
        if (isErr(err3)) { return err3; }
        let err4 = this._checkPathIsValid(doc.path, doc.deleteAfter);
        if (isErr(err4)) { return err4; }
        let err5 = this._checkAuthorIsValid(doc.author);
        if (isErr(err5)) { return err5; }
        let err6 = this._checkWorkspaceIsValid(doc.workspace);
        if (isErr(err6)) { return err6; }
        let err7 = this._checkAuthorSignatureIsValid(doc);
        if (isErr(err7)) { return err7; }
        let err8 = this._checkContentMatchesHash(doc.content, doc.contentHash);
        if (isErr(err8)) { return err8; }
        return true;
    }

    static _checkBasicDocumentValidity(doc: Document): true | ValidationError {
        // Check that the document has only the expected properties
        // and that they have the expected data types.
        // return a ValidationError, or return true on success.

        if (!isPlainObject(doc)) {
            return new ValidationError('doc must be an object, but is ' + JSON.stringify(doc));
        }

        if (doc.format !== this.format) {
            return new ValidationError('invalid format: ' + doc.format);
        }

        let validTypes = (
               typeof doc.format === 'string'
            && typeof doc.workspace === 'string'
            && typeof doc.path === 'string'
            && typeof doc.contentHash === 'string'
            && typeof doc.content === 'string'  // TODO: or null
            && typeof doc.author === 'string'
            && isInt(doc.timestamp)
            && isIntOrNull(doc.deleteAfter)
            && typeof doc.signature === 'string'
        );
        if (!validTypes) { return new ValidationError('invalid types or missing fields in document'); }

        // Don't allow extra properties in the object
        let keys = Object.keys(doc).sort();
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
            return new ValidationError('doc has extra fields');
        }

        // TODO: string length limits

        return true;
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

        // Timestamps have to be in microseconds.
        // If the timestamp is small enough that it was probably
        // accidentally created with milliseconds or seconds,
        // the message is invalid.

        if (typeof timestamp !== 'number' || timestamp !== Math.floor(timestamp)) {
            return new ValidationError('timestamp must be an integer');
        }
        if (isNaN(timestamp)) {
            return new ValidationError("timestamp can't be NaN");
        }

        if (timestamp <= 9999999999999) {
            return new ValidationError('timestamp less than minimum allowed value');
        }
        // Timestamp must be less than Number.MAX_SAFE_INTEGER.
        if (timestamp > 9007199254740991) {
            return new ValidationError('timestamp greater than maximum allowed value');
        }
        // Timestamp must not be from the future.
        if (timestamp > now + FUTURE_CUTOFF_MICROSECONDS) {
            return new ValidationError('timestamp too far in the future');
        }
        // Ephemeral documents
        if (deleteAfter !== null) {
            // basic checks
            if (typeof deleteAfter !== 'number' || deleteAfter !== Math.floor(deleteAfter)) {
                return new ValidationError('deleteAfter must be an integer');
            }
            if (isNaN(deleteAfter)) {
                return new ValidationError("deleteAfter can't be NaN");
            }

            if (deleteAfter <= 9999999999999) {
                return new ValidationError('deleteAfter less than minimum allowed value');
            }
            // Timestamp must be less than Number.MAX_SAFE_INTEGER.
            if (deleteAfter > 9007199254740991) {
                return new ValidationError('deleteAfter greater than maximum allowed value');
            }
            // Expiration date has passed
            if (now > deleteAfter) {
                return new ValidationError('ephemeral doc has expired');
            }
            // Expired before it was created??
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
        if (path.length < 2) {
            return new ValidationError('invalid path: must not be shorter than 2 characters');
        }
        if (path.length > 512) {
            return new ValidationError('invalid path: must not be longer than 512 characters');
        }
        if (!onlyHasChars(path, pathChars)) {
            return new ValidationError('invalid path: must not contain disallowed characters');
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
    static _checkAuthorIsValid(authorAddress: AuthorAddress): true | ValidationError {
        // Ensure the author address matches the spec.
        // return a ValidationError, or return true on success.
        let addr = this.parseAuthorAddress(authorAddress);
        if (isErr(addr)) { return addr; }
        return true;
    }
    static _checkWorkspaceIsValid(workspaceAddress: WorkspaceAddress): true | ValidationError {
        // Ensure the workspace address matches the spec.
        // return a ValidationError, or return true on success.
        let addr = this.parseWorkspaceAddress(workspaceAddress);
        if (isErr(addr)) { return addr; }
        return true;
    }
    static _checkAuthorSignatureIsValid(doc: Document): true | ValidationError {
        // Check if the signature is good.
        // return a ValidationError, or return true on success.
        try {
            let hash = this.hashDocument(doc);
            if (isErr(hash)) { return hash; }
            let verified = verify(doc.author, doc.signature, hash);
            if (verified === false) { return new ValidationError('signature is invalid'); }
            return true;
        } catch (err) {
            return new ValidationError('signature is invalid');
        }
    }
    static _checkContentMatchesHash(content: string, contentHash: EncodedHash): true | ValidationError {
        // Ensure the contentHash matches the actual content.
        // return a ValidationError, or return true on success.

        // TODO: if content is null, skip this check
        let shaContent = sha256base32(content);
        if (contentHash !== shaContent) {
            return new ValidationError(`content does not match contentHash.  sha256(content) is ${shaContent} but contentHash is ${contentHash}`);
        }
        return true;
    }

    static parseAuthorAddress(addr : AuthorAddress) : AuthorParsed | ValidationError {
        // Break apart the address into its parts.
        // Can return a ValidationError if the address is not valid.

        // example: @suzy.b2hd23dh....

        if (typeof addr !== 'string') {
            return new ValidationError(`author address ${JSON.stringify(addr)} must be a string!`);
        }
        if (!isOnlyPrintableAscii(addr)) {
            return new ValidationError(`author address ${JSON.stringify(addr)} must not have nonprintable or non-ASCII characters`);
        }
        if (!addr.startsWith('@')) {
            return new ValidationError(`author address ${JSON.stringify(addr)} must start with "@"`);
        }
        if (!onlyHasChars(addr, authorAddressChars)) {
            return new ValidationError(`author address ${JSON.stringify(addr)} must not use disallowed characters`);
        }
        let parts = addr.slice(1).split('.');
        if (parts.length !== 2) {
            return new ValidationError(`author address ${JSON.stringify(addr)} must be two parts separated by "."`);
        }
        let [shortname, pubkey] = parts;
        if (shortname.length !== 4) {
            return new ValidationError(`author shortname ${JSON.stringify(shortname)} must be 4 characters long`);
        }
        if (pubkey.length !== 53) {
            // 53 chars including the leading 'b' == 52 chars of actual base32 data
            return new ValidationError(`author pubkey ${JSON.stringify(pubkey)} must be 53 characters long`);
        }
        if (pubkey[0] !== 'b') {
            return new ValidationError(`author pubkey ${JSON.stringify(pubkey)} must start with 'b'`);
        }
        if (digits.indexOf(shortname[0]) !== -1) {
            return new ValidationError(`author shortname ${JSON.stringify(shortname)} must not start with a number`);
        }
        if (digits.indexOf(pubkey[0]) !== -1) {
            return new ValidationError(`author pubkey ${JSON.stringify(pubkey)} must not start with a number`);
        }
        if (!onlyHasChars(shortname, authorShortnameChars)) {
            return new ValidationError(`author shortname ${JSON.stringify(shortname)} must not use disallowed characters`);
        }
        if (!onlyHasChars(pubkey, b32chars)) {
            return new ValidationError(`author pubkey ${JSON.stringify(pubkey)} must not use disallowed characters`);
        }
        return {
            address: addr,
            shortname: shortname,
            pubkey: pubkey,
        };
    }
    static parseWorkspaceAddress(addr : WorkspaceAddress) : WorkspaceParsed | ValidationError{
        // Break apart the address into its parts.
        // Can return a ValidationError if the address is not valid.

        // example unlisted workspace:                  +solarpunk.anythinghere
        // example invite-only (53 chars of pubkey):    +solarpunk.b2ojhodi3...
        if (!isOnlyPrintableAscii(addr)) {
            return new ValidationError(`workspace address ${JSON.stringify(addr)} must not have nonprintable or non-ASCII characters`);
        }
        if (!addr.startsWith('+')) {
            return new ValidationError(`workspace address ${JSON.stringify(addr)} must start with "+"`);
        }
        if (!onlyHasChars(addr, workspaceAddressChars)) {
            return new ValidationError(`workspace address ${JSON.stringify(addr)} must not use disallowed characters`);
        }
        let parts = addr.slice(1).split('.');
        if (parts.length !== 2) {
            return new ValidationError(`workspace address ${JSON.stringify(addr)} must be two parts separated by "."`);
        }
        let [name, pubkey] = parts;
        if (name.length < 1 || name.length > 15) {
            return new ValidationError(`workspace name ${JSON.stringify(name)} must be between 1 and 15 characters long`);
        }
        if (pubkey.length < 1 || pubkey.length > 53) {
            return new ValidationError(`workspace key ${JSON.stringify(pubkey)} must be between 1 and 53 characters long`);
        }
        if (digits.indexOf(name[0]) !== -1) {
            return new ValidationError(`workspace name ${JSON.stringify(name)} must not start with a number`);
        }
        if (digits.indexOf(pubkey[0]) !== -1) {
            return new ValidationError(`workspace key ${JSON.stringify(pubkey)} must not start with a number`);
        }
        if (!onlyHasChars(name, workspaceNameChars)) {
            return new ValidationError(`workspace name ${JSON.stringify(name)} must not use disallowed characters`);
        }
        if (!onlyHasChars(pubkey, alphaLower + digits)) {
            return new ValidationError(`workspace key ${JSON.stringify(pubkey)} must not use disallowed characters`);
        }
        return {
            address: addr,
            name: name,
            pubkey: pubkey,
        };
    }
}
