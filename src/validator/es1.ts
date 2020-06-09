import { Keypair, FormatName, Item, IValidator, Key, RawCryptKey } from '../util/types';
import { Crypto } from '../crypto/crypto';
import { isOnlyPrintableAscii } from '../util/parse';

let log = console.log;
let logWarning = console.log;
//let log = (...args : any[]) => void {};  // turn off logging for now
//let logWarning = (...args : any[]) => void {};  // turn off logging for now

export const ValidatorEs1 : IValidator = class {
    static format : FormatName = 'es.1';
    static keyIsValid(key: Key): boolean {
        if (!isOnlyPrintableAscii(key)) {
            logWarning('invalid key: contains non-printable or non-ascii characters');
            return false;
        }
        return true;
    }
    static authorCanWriteToKey(author: RawCryptKey, key: Key): boolean {
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
    static hashItem(item: Item): string {
        // This is used for signatures and references to specific items.
        // We use the hash of the value so we can drop the actual value
        // and only keep the hash around for verifying signatures,
        // though we're not using that ability yet.
        // None of these fields are allowed to contain newlines
        // except for value, but value is hashed, so it's safe to
        // use newlines as a field separator.
        // We enforce the no-newlines rules in itemIsValid() and keyIsValid().
        return Crypto.sha256([
            item.format,
            item.workspace,
            item.key,
            Crypto.sha256(item.value),
            '' + item.timestamp,
            item.author,
        ].join('\n'));
    }
    static signItem(keypair : Keypair, item: Item): Item {
        return {
            ...item,
            signature: Crypto.sign(keypair, this.hashItem(item)),
        };
    }
    static itemSignatureIsValid(item: Item): boolean {
        try {
            return Crypto.verify(item.author, item.signature, this.hashItem(item));
        } catch (e) {
            return false;
        }
    }
    static itemIsValid(item: Item, futureCutoff?: number): boolean {
        // "futureCutoff" is a time in microseconds (milliseconds * 1000).
        // If a message is from after futureCutoff, it's not valid.
        // It defaults to 10 minutes in the future.
        const FUTURE_CUTOFF_MINUTES = 10;
        futureCutoff = futureCutoff || (Date.now() + FUTURE_CUTOFF_MINUTES * 60 * 1000) * 1000;

        if (   typeof item.format !== 'string'
            || typeof item.workspace !== 'string'
            || typeof item.key !== 'string'
            || typeof item.value !== 'string'
            || typeof item.author !== 'string'
            || typeof item.timestamp !== 'number'
            || typeof item.signature !== 'string'
        ) {
            logWarning('itemIsValid: item properties have wrong type(s)');
            return false;
        }

        // Don't allow extra properties in the object
        if (Object.keys(item).length !== 7) {
            logWarning('itemIsValid: item has extra properties');
            return false;
        }

        // item.format should have already been checked by the store, when it decides
        // which validator to use.  But let's check it anyway.
        if (item.format !== this.format) {
            logWarning('itemIsValid: format does not match');
            return false;
        }

        // TODO: size / length limits
        // Use Buffer.byteLength(string, 'utf8') to count bytes in a string.

        // Timestamps have to be in microseconds.
        // If the timestamp is small enough that it was probably
        // accidentally created with milliseconds or seconds,
        // the message is invalid.
        if (item.timestamp <= 9999999999999) {
            logWarning('itemIsValid: timestamp too small');
            return false;
        }
        // Timestamp must be less than Number.MAX_SAFE_INTEGER.
        if (item.timestamp > 9007199254740991) {
            logWarning('itemIsValid: timestamp too large');
            return false;
        }
        // Timestamp must not be from the future.
        if (item.timestamp > futureCutoff) {
            logWarning('itemIsValid: timestamp is in the future');
            return false;
        }

        // No non-printable ascii characters or unicode (except item.value)
        // (the format is caught earlier by checking if item.format === this.format)
        /* istanbul ignore next */
        if (!isOnlyPrintableAscii(item.format)) {
            logWarning('itemIsValid: format contains non-printable ascii characters');
            return false;
        }
        if (!isOnlyPrintableAscii(item.workspace)) {
            logWarning('itemIsValid: workspace contains non-printable ascii characters');
            return false;
        }
        if (!isOnlyPrintableAscii(item.author)) {
            logWarning('itemIsValid: author contains non-printable ascii characters');
            return false;
        }
        if (!isOnlyPrintableAscii(item.signature)) {
            logWarning('itemIsValid: signature contains non-printable ascii characters');
            return false;
        }

        // Key must be valid (only printable ascii, etc)
        if (!this.keyIsValid(item.key)) {
            logWarning('itemIsValid: key not valid');
            return false;
        }

        // Author must start with '@'
        if (!item.author.startsWith('@')) {
            logWarning('itemIsValid: author must start with @');
            return false;
        }

        // Author must have write permission
        if (!this.authorCanWriteToKey(item.author, item.key)) {
            logWarning('itemIsValid: author can\'t write to key');
            return false;
        }

        // Check signature last since it's slow and all the above checks
        // are simple and safe enough to do on untrusted data.
        if (!this.itemSignatureIsValid(item)) {
            logWarning('itemIsValid: invalid signature');
            return false;
        }

        return true;
    }
}
