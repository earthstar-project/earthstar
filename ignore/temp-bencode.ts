import bencode = require('bencode');
import { deepEqual } from 'fast-equals';

let log = console.log;

let now = 1500000000000000;
let snowmanJsString = '☃';
let invalidUnicode = Buffer.from([127, 128]);  // this is invalid unicode

let doc = {
    path: '/path/goes/here',
    value: 'newlines\n\nnewlines' + snowmanJsString,
    timestamp: now,
    binary: invalidUnicode,
    null: null,
    undefined: undefined,
    nested: { nested: { nested: [1, 2, 3] } },
};
let doc2 = {
    ...doc,
    timestamp: doc.timestamp
};

let encodedBuf = bencode.encode(doc);
let encodedBuf2 = bencode.encode(doc2);
let encodedStr = encodedBuf.toString('utf8');
let encodedStr2 = encodedBuf2.toString('utf8');
let decodedToBufs = bencode.decode(encodedBuf);
let decodedToStrs = bencode.decode(encodedBuf, undefined, undefined, 'utf8');

log()
log('orig', doc);
log()
log('encodedBuf', encodedBuf);
log()
log('encodedStr', encodedStr);
log()
log('deterministic key order:', encodedStr === encodedStr2);
log()
log('decoded to bufs', decodedToBufs);
log()
log('decoded to strs', decodedToStrs);
log()
log('roundtrip deep equals:', deepEqual(doc, decodedToStrs));
log()
log('decoded binary to buffer', [...decodedToBufs.binary]);
log('decoded binary to string to buffer', [...Buffer.from(decodedToStrs.binary, 'utf8')]);

log();
log();
log('=======================================');
log();

//================================================================================

type BuffableType = null | string | Buffer | number | boolean | {[key:string]: BuffableType} | Array<BuffableType>;

// Type tags:
//  "s:"  string (utf8)
//  "n:"  null -- this will be used as a tombstone for deleted documents
//  "b:"  raw buffer
//  "j:"  JSON (number, bool, object, or array)

// Convert any of the Buffable types above into a buffer, prefixed with a type tag.
// This will throw an Error if the input value is an unsupported type
let valToBuf = (val : BuffableType) : Buffer => {
    let tag : string;
    let buf : Buffer;
    if (typeof val === 'string') {
        tag = 's:';
        buf = Buffer.from(val, 'utf8');
    } else if (val === null) {
        tag = 'n:';
        buf = Buffer.from('');
    } else if (val instanceof Buffer) {
        tag = 'b:';
        buf = val;
    } else if (typeof val === 'boolean' || typeof val === 'object' || typeof val === 'number' || Array.isArray(val)) {
        tag = 'j:';
        buf = Buffer.from(JSON.stringify(val));
    } else {
        throw new Error('unsupported data type: ' + JSON.stringify(val));
    }
    return Buffer.concat([Buffer.from(tag, 'utf8'), buf]);
}
let valToString = (val : BuffableType) : string => {
    let tag : string;
    let str : string;
    if (typeof val === 'string') {
        tag = 's:';
        str = val;
    } else if (val === null) {
        tag = 'n:';
        str = '';
    } else if (val instanceof Buffer) {
        tag = 'b:';
        str = val.toString('base64');
    } else if (typeof val === 'boolean' || typeof val === 'object' || typeof val === 'number' || Array.isArray(val)) {
        tag = 'j:';
        str = JSON.stringify(val);
    } else {
        throw new Error('unsupported data type: ' + JSON.stringify(val));
    }
    return tag + str;
}
// Convert from buffer back to actual type
// This can throw a SyntaxError if JSON is invalid,
// or a generic Error if the buffer is empty or doesn't start with a known type tag
let bufToVal = (buf : Buffer) : BuffableType => {
    let tag = buf.slice(0, 2).toString();
    let data = buf.slice(2);
    if (tag === 's:') { return data.toString('utf8'); }
    if (tag === 'n:') { return null; }
    if (tag === 'b:') { return data; }
    if (tag === 'j:') { return JSON.parse(data.toString('utf8')); }
    else { throw new Error('unsupported data type: ' + tag); }
}
let stringToVal = (str : string) : BuffableType => {
    let tag = str.slice(0, 2);
    let data = str.slice(2);
    if (tag === 's:') { return data; }
    if (tag === 'n:') { return null; }
    if (tag === 'b:') { return Buffer.from(data, 'base64'); }
    if (tag === 'j:') { return JSON.parse(data); }
    else { throw new Error('unsupported data type: ' + tag); }
}

let vals : BuffableType[] = [
    'A string',
    'snowman' + snowmanJsString,
    null,
    true,
    false,
    Buffer.from([41,0,0,0,0,43]),
    invalidUnicode,
    {a:1, b:2},
    12345,
    12.345,
    [1, 2, 3, 4],
]

for (let val of vals) {
    let buf = valToString(val);
    let val2 = stringToVal(buf);
    log('--------------------');
    log('orig', val);
    log('buf', buf);
    //log('buf as string', buf.toString('utf8'));
    log('val2', val2);
    log('match? ', deepEqual(val, val2));
}


