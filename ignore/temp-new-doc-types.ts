import {
    AuthorAddress,
    FormatName,
    EncodedHash,
    Path,
    EncodedSig,
    WorkspaceAddress,
} from '../src/util/types';
import {
    authorAddressChars,
    alphaLower,
    digits,
    b32chars,
    hexLower,
    pathChars,
    printableAscii,
    workspaceAddressChars,
} from '../src/util/characters';
import {
    CheckerSchema,
    checkInt,
    checkObj,
    checkString,
} from '../src/util/checkers';
let log = console.log;

// ================================================================================
// ================================================================================
// core validity check:
//     has all these fields
//     all fields are ascii only (except timestamp is number)
//     format is on allowlist
//     timestamp in range
//     deleteAfter timestamp
//     workspace is valid URL location
//     path character set
//     author character set
// 
// core or format?
//     workspace format
//     path format
//     author format
//    
// format validity check:
//     author can write to path
//     hash document
//     hash content (& check if it matches contentHash)
//     signature is valid
//     extra: workspace signature


//================================================================================
// Types

type Ob = {[k : string] : any}


//================================================================================
// Specific schema

interface DocCore {
    format: FormatName,
    workspace: WorkspaceAddress,
    path: Path,
    contentHash: EncodedHash,
    author: AuthorAddress,
    timestamp: number,
    signature: EncodedSig,
    deleteAfter?: number,
};
interface DocAnyFormat extends DocCore {
    // allow extra properties of any type
    [k : string] : any,
}
interface DocES4 extends DocCore {
    format: 'es.4',
    workspaceSignature?: EncodedSig,
}

let MIN_TIMESTAMP = 35184372088832;  // 2**45
let MAX_TIMESTAMP = 9007199254740990;  // 2**53 - 2.  One smaller than Number.MAX_SAFE_INTEGER.
let DOC_CORE_SCHEMA : CheckerSchema = {
    format:      checkString({minLen: 1, maxLen: 256, allowedChars: printableAscii}),
    workspace:   checkString({minLen: 1, maxLen: 256, allowedChars: workspaceAddressChars}),
    path:        checkString({minLen: 1, maxLen: 256, allowedChars: pathChars}),
    contentHash: checkString({minLen: 1, maxLen: 256, allowedChars: hexLower}),
    author:      checkString({minLen: 1, maxLen: 256, allowedChars: authorAddressChars}),
    signature:   checkString({minLen: 1, maxLen: 256, allowedChars: b32chars}),
    timestamp:   checkInt({min: MIN_TIMESTAMP, max: MAX_TIMESTAMP}),
    deleteAfter: checkInt({min: MIN_TIMESTAMP, max: MAX_TIMESTAMP, optional: true}),
}
let DOC_CORE_FIELDS = Object.keys(DOC_CORE_SCHEMA).sort();
let DOC_CORE_VALIDATOR = checkObj({
    allowUndefined: false,
    allowExtraKeys: false,
    objSchema: DOC_CORE_SCHEMA,
});
let DOC_ANY_VALIDATOR = checkObj({
    allowUndefined: false,
    allowExtraKeys: true,
    objSchema: DOC_CORE_SCHEMA,
});

let DOC_ES4_SCHEMA : CheckerSchema = {
    ...DOC_CORE_SCHEMA,
    workspaceSignature: checkString({minLen: 1, maxLen: 256, allowedChars: b32chars, optional: true}),
}
let DOC_ES4_VALIDATOR = checkObj({
    allowUndefined: false,
    allowExtraKeys: false,
    objSchema: DOC_ES4_SCHEMA,
});

//================================================================================
// Try out validators

let doc4ext : DocES4 = {
    format: 'es.4',
    workspace: '+gardening.xxx',
    path: '/wiki/Flowers',
    contentHash: '910318a18098b09c2d2e20f',
    author: '@suzy.xxx',
    timestamp: 1595557486374000,
    deleteAfter: 1595557486374000,
    signature: 'xxx',
    workspaceSignature: 'xxxxx',
};

log('core validator error:', DOC_CORE_VALIDATOR(doc4ext));
log('any validator error:', DOC_ANY_VALIDATOR(doc4ext));
log('es4 validator error:', DOC_ES4_VALIDATOR(doc4ext));

//================================================================================
// Hashing

let sortedObj = <T>(obj : T) : T => {
    // return a shallow copy of an object with its keys sorted in alphabetical order
    let result : Ob = {};
    for (let key of Object.keys(obj).sort()) { result[key] = (obj as Ob)[key]; }
    return result as T;
}

let serializeObjForHashing = (doc : Ob) : string =>
    // turn an object into a deterministic string.
    // assumes keys and values can only contain printable ascii characters (especially not \n and \t).
    // values should only be strings or integers.
    // treats "123" and 123 the same, so make sure you check your object for expected types before hashing it.
    Object.entries(sortedObj(doc)).map(([k, v]) =>
        `${k}\t${v}\n`
    ).join('');

let splitDocToCoreAndExtraFields = (doc : DocAnyFormat) : {core : DocCore, extra : Ob} => {
    // split a doc into 2 objects: the core fields, and any extra fields.
    // both will have alphabetically sorted fields.
    let core : Ob = {};
    let extra : Ob = sortedObj(doc);
    // (CORE_FIELDS is sorted, so core will also be sorted)
    for (let key of DOC_CORE_FIELDS) {
        core[key] = extra[key];
        delete extra[key];
    }
    return {core: core as DocCore, extra};
}

let doc = doc4ext;
log();
log(JSON.stringify(doc, null, 4));
log(JSON.stringify(sortedObj(doc), null, 4));
log();
log(serializeObjForHashing(doc));
log();
log(splitDocToCoreAndExtraFields(doc));
let {core, extra} = splitDocToCoreAndExtraFields(doc);
log(JSON.stringify(extra));









