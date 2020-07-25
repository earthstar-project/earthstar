import {
    AuthorAddress,
    FormatName,
    Path,
    Signature,
    WorkspaceAddress,
} from '../util/types';
import {
    authorAddressChars,
    b32chars,
    hexLower,
    pathChars,
    printableAscii,
    workspaceAddressChars,
} from '../util/characters';
import {
    AsserterSchema,
    assertInt,
    assertObj,
    assertString,
} from '../util/asserters';
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

type HexHash = string;
interface DocCore {
    format: FormatName,
    workspace: WorkspaceAddress,
    path: Path,
    contentHash: HexHash,
    author: AuthorAddress,
    timestamp: number,
    signature: Signature,
    deleteAfter?: number,
};
interface DocAnyFormat extends DocCore {
    // allow extra properties of any type
    [k : string] : any,
}
interface DocES4 extends DocCore {
    format: 'es.4',
    workspaceSignature?: Signature,
}

let MIN_TIMESTAMP = 35184372088832;  // 2**45
let MAX_TIMESTAMP = 9007199254740990;  // 2**53 - 2.  One smaller than Number.MAX_SAFE_INTEGER.
let DOC_CORE_SCHEMA : AsserterSchema = {
    format:      assertString({minLen: 1, maxLen: 256, allowedChars: printableAscii}),
    workspace:   assertString({minLen: 1, maxLen: 256, allowedChars: workspaceAddressChars}),
    path:        assertString({minLen: 1, maxLen: 256, allowedChars: pathChars}),
    contentHash: assertString({minLen: 1, maxLen: 256, allowedChars: hexLower}),
    author:      assertString({minLen: 1, maxLen: 256, allowedChars: authorAddressChars}),
    signature:   assertString({minLen: 1, maxLen: 256, allowedChars: b32chars}),
    timestamp:   assertInt({min: MIN_TIMESTAMP, max: MAX_TIMESTAMP}),
    deleteAfter: assertInt({min: MIN_TIMESTAMP, max: MAX_TIMESTAMP, optional: true}),
}
let DOC_CORE_FIELDS = Object.keys(DOC_CORE_SCHEMA).sort();
let DOC_CORE_VALIDATOR = assertObj({
    allowUndefined: false,
    allowExtraKeys: false,
    objSchema: DOC_CORE_SCHEMA,
});
let DOC_ANY_VALIDATOR = assertObj({
    allowUndefined: false,
    allowExtraKeys: true,
    objSchema: DOC_CORE_SCHEMA,
});

let DOC_ES4_SCHEMA : AsserterSchema = {
    ...DOC_CORE_SCHEMA,
    workspaceSignature: assertString({minLen: 1, maxLen: 256, allowedChars: b32chars, optional: true}),
}
let DOC_ES4_VALIDATOR = assertObj({
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









