import { AuthorKey, Item, ICodec, Key, RawCryptKey } from './types';
import { isSignatureValid, removeSigilFromKey, sha256, sign } from './crypto';

let log = console.log;
let logWarning = console.log;
//let log = (...args : any[]) => void {};  // turn off logging for now
//let logWarning = (...args : any[]) => void {};  // turn off logging for now

export const CodecKw1 : ICodec = class {
    static getName() : string { return 'kw.1'; }
    static keyIsValid(key: Key): boolean {
        // TODO: check for valid utf8?
        if (key.length === 0) {
            logWarning('invalid key: length === 0');
            return false;
        }
        if (key.indexOf('\n') !== -1) {
            logWarning('invalid key: contains "\\n"');
            return false;
        }
        // TODO: try adding a literal '*' and see if it screws up sqlite LIKE
        return true;
    }
    static authorCanWriteToKey(author: AuthorKey, key: Key): boolean {
        // Note that multiple authors are allowed: "(@a)(@b)" means both have write permission
        if (key.indexOf('(') === -1 && key.indexOf(')') === -1) {
            // key has no parens: it's public.
            return true;
        }
        if (key.indexOf('(' + author + ')') !== -1) {
            // key contains (author).  the author can write here.
            return true;
        }
        // key contains at least one paren but not (author).  The author can't write here.
        logWarning('author can\'t write to key');
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
        return sha256([
            item.codec,
            item.workspace,
            item.key,
            sha256(item.value),
            '' + item.timestamp,
            item.author,
        ].join('\n'));
    }
    static signItem(item: Item, secret: RawCryptKey): Item {
        return {
            ...item,
            signature: sign(this.hashItem(item), secret),
        };
    }
    static itemSignatureIsValid(item: Item): boolean {
        return isSignatureValid(this.hashItem(item), item.signature, removeSigilFromKey(item.author));
    }
    static itemIsValid(item: Item, futureCutoff?: number): boolean {
        // "futureCutoff" is a time in microseconds (milliseconds * 1000).
        // If a message is from after futureCutoff, it's not valid.
        // It defaults to 10 minutes in the future.

        const FUTURE_CUTOFF_MINUTES = 10;
        futureCutoff = futureCutoff || (Date.now() + FUTURE_CUTOFF_MINUTES * 60 * 1000) * 1000;
        if (   typeof item.codec !== 'string'
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

        // don't allow extra properties
        if (Object.keys(item).length !== 7) {
            logWarning('itemIsValid: item has extra properties');
            return false;
        }

        // item.codec is checked against the approved list of values by the store

        // TODO: size / length limits
        // Use Buffer.byteLength(string, 'utf8') to count bytes in a string.
        // Timestamps have to be in microseconds.
        // If the timestamp is small enough that it was probably
        // accidentally created with milliseconds or seconds,
        // the message is invalid.
        if (item.timestamp < 9999999999999) {
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

        // Codec can't contain newline.
        if (item.codec.indexOf('\n') !== -1) {
            logWarning('itemIsValid: codec contains newline');
            return false;
        }
        // Workspace can't contain newline.
        if (item.workspace.indexOf('\n') !== -1) {
            logWarning('itemIsValid: workspace contains newline');
            return false;
        }
        // Key can't contain newline, plus has other restrictions.
        if (!this.keyIsValid(item.key)) {
            logWarning('itemIsValid: key not valid');
            return false;
        }
        // Value CAN contain newline
        // Author can't contain newline.
        if (item.author.indexOf('\n') !== -1) {
            logWarning('itemIsValid: author contains newline');
            return false;
        }
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
