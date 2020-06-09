import { Keypair, FormatName, Document, IValidator, Path, RawCryptKey } from '../util/types';
import { Crypto } from '../crypto/crypto';
import { isOnlyPrintableAscii } from '../util/parse';

let log = console.log;
let logWarning = console.log;
//let log = (...args : any[]) => void {};  // turn off logging for now
//let logWarning = (...args : any[]) => void {};  // turn off logging for now

export const ValidatorEs2 : IValidator = class {
    static format : FormatName = 'es.2';
    static pathIsValid(path: Path): boolean {
        if (!isOnlyPrintableAscii(path)) {
            logWarning('invalid key: contains non-printable or non-ascii characters');
            return false;
        }
        return true;
    }
    static authorCanWriteToPath(author: RawCryptKey, key: Path): boolean {
        // no tilde: it's public
        if (key.indexOf('~') === -1) {
            return true;
        }
        // key contains "~" + author.  the author can write here.
        if (key.indexOf('~' + author) !== -1) {
            return true;
        }
        // key contains at least one tilde but not ~@author.  The author can't write here.
        logWarning(`author ${author} can't write to key ${key}`);
        return false;
    }
    static hashDocument(doc: Document): string {
        // This is used for signatures and references to specific items.
        // We use the hash of the value so we can drop the actual value
        // and only keep the hash around for verifying signatures,
        // though we're not using that ability yet.
        // None of these fields are allowed to contain newlines
        // except for value, but value is hashed, so it's safe to
        // use newlines as a field separator.
        // We enforce the no-newlines rules in itemIsValid() and keyIsValid().
        return Crypto.sha256([
            doc.format,
            doc.workspace,
            doc.path,
            Crypto.sha256(doc.value),
            '' + doc.timestamp,
            doc.author,
        ].join('\n'));
    }
    static signDocument(keypair : Keypair, doc: Document): Document {
        return {
            ...doc,
            signature: Crypto.sign(keypair, this.hashDocument(doc)),
        };
    }
    static documentSignatureIsValid(doc: Document): boolean {
        try {
            return Crypto.verify(doc.author, doc.signature, this.hashDocument(doc));
        } catch (e) {
            return false;
        }
    }
    static documentIsValid(doc: Document, futureCutoff?: number): boolean {
        // "futureCutoff" is a time in microseconds (milliseconds * 1000).
        // If a message is from after futureCutoff, it's not valid.
        // It defaults to 10 minutes in the future.
        const FUTURE_CUTOFF_MINUTES = 10;
        futureCutoff = futureCutoff || (Date.now() + FUTURE_CUTOFF_MINUTES * 60 * 1000) * 1000;

        if (   typeof doc.format !== 'string'
            || typeof doc.workspace !== 'string'
            || typeof doc.path !== 'string'
            || typeof doc.value !== 'string'
            || typeof doc.author !== 'string'
            || typeof doc.timestamp !== 'number'
            || typeof doc.signature !== 'string'
        ) {
            logWarning('itemIsValid: item properties have wrong type(s)');
            return false;
        }

        // Don't allow extra properties in the object
        if (Object.keys(doc).length !== 7) {
            logWarning('itemIsValid: item has extra properties');
            return false;
        }

        // item.format should have already been checked by the store, when it decides
        // which validator to use.  But let's check it anyway.
        if (doc.format !== this.format) {
            logWarning('itemIsValid: format does not match');
            return false;
        }

        // TODO: size / length limits
        // Use Buffer.byteLength(string, 'utf8') to count bytes in a string.

        // Timestamps have to be in microseconds.
        // If the timestamp is small enough that it was probably
        // accidentally created with milliseconds or seconds,
        // the message is invalid.
        if (doc.timestamp <= 9999999999999) {
            logWarning('itemIsValid: timestamp too small');
            return false;
        }
        // Timestamp must be less than Number.MAX_SAFE_INTEGER.
        if (doc.timestamp > 9007199254740991) {
            logWarning('itemIsValid: timestamp too large');
            return false;
        }
        // Timestamp must not be from the future.
        if (doc.timestamp > futureCutoff) {
            logWarning('itemIsValid: timestamp is in the future');
            return false;
        }

        // No non-printable ascii characters or unicode (except item.value)
        // (the format is caught earlier by checking if item.format === this.format)
        /* istanbul ignore next */
        if (!isOnlyPrintableAscii(doc.format)) {
            logWarning('itemIsValid: format contains non-printable ascii characters');
            return false;
        }
        if (!isOnlyPrintableAscii(doc.workspace)) {
            logWarning('itemIsValid: workspace contains non-printable ascii characters');
            return false;
        }
        if (!isOnlyPrintableAscii(doc.author)) {
            logWarning('itemIsValid: author contains non-printable ascii characters');
            return false;
        }
        if (!isOnlyPrintableAscii(doc.signature)) {
            logWarning('itemIsValid: signature contains non-printable ascii characters');
            return false;
        }

        // Key must be valid (only printable ascii, etc)
        if (!this.pathIsValid(doc.path)) {
            logWarning('itemIsValid: key not valid');
            return false;
        }

        // Author must start with '@'
        if (!doc.author.startsWith('@')) {
            logWarning('itemIsValid: author must start with @');
            return false;
        }

        // Author must have write permission
        if (!this.authorCanWriteToPath(doc.author, doc.path)) {
            logWarning('itemIsValid: author can\'t write to key');
            return false;
        }

        // Check signature last since it's slow and all the above checks
        // are simple and safe enough to do on untrusted data.
        if (!this.documentSignatureIsValid(doc)) {
            logWarning('itemIsValid: invalid signature');
            return false;
        }

        return true;
    }
}
