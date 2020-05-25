import { AuthorKey, Item, Key, RawCryptKey } from './types';
import { isSignatureValid, removeSigilFromKey, sha256, sign } from './crypto';

export let keyIsValid = (key: Key): boolean => {
    // TODO: check for valid utf8?
    if (key.length === 0) {
        return false;
    }
    if (key.indexOf('\n') !== -1) {
        return false;
    }
    // TODO: try adding a literal '*' and see if it screws up sqlite LIKE
    return true;
};

export let authorCanWriteToKey = (author: AuthorKey, key: Key): boolean => {
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
    return false;
};

export let hashItem = (item: Item): string =>
    // This is used for signatures and references to specific items.
    // We use the hash of the value so we can drop the actual value
    // and only keep the hash around for verifying signatures,
    // though we're not using that ability yet.
    // None of these fields are allowed to contain newlines
    // except for value, but value is hashed, so it's safe to
    // use newlines as a field separator.
    // We enforce the no-newlines rules in itemIsValid() and keyIsValid().
    sha256([
        item.schema,
        item.workspace,
        item.key,
        sha256(item.value),
        '' + item.timestamp,
        item.author,
    ].join('\n'));

export let signItem = (item: Item, secret: RawCryptKey): Item => ({
    ...item,
    signature: sign(hashItem(item), secret),
});

export let itemSignatureIsValid = (item: Item): boolean => isSignatureValid(hashItem(item), item.signature, removeSigilFromKey(item.author));

export let itemIsValid = (item: Item, futureCutoff?: number): boolean => {
    // "futureCutoff" is a time in microseconds (milliseconds * 1000).
    // If a message is from after futureCutoff, it's not valid.
    // It defaults to 10 minutes in the future.

    if (item.schema !== 'kw.1') { return false; } // TODO: make global list of allowed schemas or something

    const FUTURE_CUTOFF_MINUTES = 10;
    futureCutoff = futureCutoff || (Date.now() + FUTURE_CUTOFF_MINUTES * 60 * 1000) * 1000;
    if (typeof item.workspace !== 'string') {
        return false;
    }
    if (typeof item.schema !== 'string') {
        return false;
    }
    if (typeof item.key !== 'string') {
        return false;
    }
    if (typeof item.value !== 'string') {
        return false;
    }
    if (typeof item.timestamp !== 'number') {
        return false;
    }
    if (typeof item.author !== 'string') {
        return false;
    }
    if (typeof item.signature !== 'string') {
        return false;
    }
    // TODO: size / length limits
    // Use Buffer.byteLength(string, 'utf8') to count bytes in a string.
    // Timestamps have to be in microseconds.
    // If the timestamp is small enough that it was probably
    // accidentally created with milliseconds or seconds,
    // the message is invalid.
    if (item.timestamp < 9999999999999) {
        return false;
    }
    // Timestamp must be less than Number.MAX_SAFE_INTEGER.
    if (item.timestamp > 9007199254740991) {
        return false;
    }
    // Timestamp must not be from the future.
    if (item.timestamp > futureCutoff) {
        return false;
    }
    // Workspace can't contain newline.
    if (item.workspace.indexOf('\n') !== -1) {
        return false;
    }
    // Schema can't contain newline.
    if (item.schema.indexOf('\n') !== -1) {
        return false;
    }
    // Key can't contain newline, plus has other restrictions.
    if (!keyIsValid(item.key)) {
        return false;
    }
    if (!authorCanWriteToKey(item.author, item.key)) {
        return false;
    }
    // Author can't contain newline.
    if (item.author.indexOf('\n') !== -1) {
        return false;
    }
    // Check signature last since it's slow and all the above checks
    // are simple and safe enough to do on untrusted data.
    if (!itemSignatureIsValid(item)) {
        return false;
    }
    return true;
};

export let historySortFn = (a: Item, b: Item): number => {
    // Sorts items within one key from multiple authors,
    // so that the winning item is first.
    // timestamp DESC (newest first), signature DESC (to break timestamp ties)
    if (a.timestamp < b.timestamp) {
        return 1;
    }
    if (a.timestamp > b.timestamp) {
        return -1;
    }
    if (a.signature < b.signature) {
        return 1;
    }
    if (a.signature > b.signature) {
        return -1;
    }
    return 0;
};
