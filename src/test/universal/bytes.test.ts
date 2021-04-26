import t = require('tap');
// Boilerplate to help browser-run know when this test is completed (see browser-run.ts)
// When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function..
declare let window: any;
if ((t.test as any).onFinish) {
    (t.test as any).onFinish(() => window.onFinish('bytes'));
}

import {
    bufferToBytes,
    bufferToString,
    bytesToBuffer,
    bytesToString,
    concatBytes,
    identifyBufOrBytes,
    isBuffer,
    isBytes,
    stringLengthInBytes,
    stringToBuffer,
    stringToBytes,
} from '../../util/bytes';

//================================================================================

// use this unicode character for testing
let snowmanString = '\u2603';  // ☃ \u2603  [0xe2, 0x98, 0x83] -- 3 bytes
let snowmanBytes = Uint8Array.from([0xe2, 0x98, 0x83]);
let snowmanBuffer = Buffer.from([0xe2, 0x98, 0x83]);

let simpleString = 'aa';
let simpleBytes = Uint8Array.from([97, 97]);
let simpleBuffer = Buffer.from([97, 97]);

//================================================================================

t.test('bytesToString', (t: any) => {
    t.same(bytesToString(simpleBytes), simpleString, 'simple bytes to string');
    t.same(bytesToString(snowmanBytes), snowmanString, 'snowman bytes to string');
    t.ok(typeof bytesToString(snowmanBytes) === 'string', 'returns a string');
    t.end();
});

t.test('stringToBytes', (t: any) => {
    t.same(stringToBytes(simpleString), simpleBytes, 'simple string to bytes');
    t.same(stringToBytes(snowmanString), snowmanBytes, 'snowman string to bytes');
    t.same(identifyBufOrBytes(stringToBytes(snowmanString)), 'bytes', 'returns bytes');
    t.end();
});

//--------------------------------------------------

t.test('bytesToBuffer', (t: any) => {
    t.same(bytesToBuffer(snowmanBytes), snowmanBuffer, 'snowman bytes to buffer')
    t.same(identifyBufOrBytes(bytesToBuffer(snowmanBytes)), 'buffer', 'returns buffer');
    t.end();
});

t.test('bufferToBytes', (t: any) => {
    t.same(bufferToBytes(snowmanBuffer), snowmanBytes, 'snowman buffer to bytes')
    t.same(identifyBufOrBytes(bufferToBytes(snowmanBuffer)), 'bytes', 'returns bytes');
    t.end();
});

//--------------------------------------------------

t.test('bufferToString', (t: any) => {
    t.same(bufferToString(simpleBuffer), simpleString, 'simple buffer to string');
    t.same(bufferToString(snowmanBuffer), snowmanString, 'snowman buffer to string');
    t.ok(typeof bufferToString(snowmanBuffer) === 'string', 'returns a string');
    t.end();
});

t.test('stringToBuffer', (t: any) => {
    t.same(stringToBuffer(simpleString), simpleBuffer, 'simple string to buffer');
    t.same(stringToBuffer(snowmanString), snowmanBuffer, 'snowman string to buffer');
    t.same(identifyBufOrBytes(stringToBuffer(snowmanString)), 'buffer', 'returns buffer');
    t.end();
});

//--------------------------------------------------

t.test('stringLengthInBytes', (t: any) =>{
    t.same(stringLengthInBytes(simpleString), 2, 'simple string');
    t.same(stringLengthInBytes(snowmanString), 3, 'snowman string');
    t.end();
});

t.test('concatBytes', (t: any) =>{
    let coldSnowmanString = 'cold' + snowmanString;
    let coldSnowmanBytes = stringToBytes(coldSnowmanString);
    let concatted = concatBytes(stringToBytes('cold'), snowmanBytes);
    t.same(concatted, coldSnowmanBytes, 'concat bytes');
    t.same(identifyBufOrBytes(concatted), 'bytes', 'returns bytes');

    t.same(concatBytes(Uint8Array.from([]), Uint8Array.from([1, 2, 3])), Uint8Array.from([1, 2, 3]), 'optimization when a is empty');
    t.same(concatBytes(Uint8Array.from([1, 2, 3]), Uint8Array.from([])), Uint8Array.from([1, 2, 3]), 'optimization when b is empty');

    t.end();
});

//--------------------------------------------------

// TODO: b64stringtobytes

// TODO: hexstringtobytes

//--------------------------------------------------

t.test('identifyBufOrBytes, isBuffer, isBytes', (t: any) =>{
    let buf = Buffer.from([1]);
    let bytes = Uint8Array.from([1]);

    t.same(identifyBufOrBytes(buf), 'buffer', 'can identify Buffer');
    t.same(identifyBufOrBytes(bytes), 'bytes', 'can identify Buffer');

    t.same(isBuffer(buf), true, 'isBuffer true');
    t.same(isBuffer(bytes), false, 'isBuffer false');
    t.same(isBytes(buf), false, 'isBytes false');
    t.same(isBytes(bytes), true, 'isBytes true');

    t.end();
});
