import t = require('tap');
// Boilerplate to help browser-run know when this test is completed (see browser-run.ts)
// When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function..
declare let window: any;
if ((t.test as any).onFinish) {
    (t.test as any).onFinish(() => window.onFinish('buffers'));
}

import {
    bufferToBytes,
    bufferToString,
    bytesToBuffer,
    stringToBuffer,
} from '../../util/buffers';

import {
    identifyBufOrBytes,
    isBytes,
    isBuffer,
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

t.test('buffer: identifyBufOrBytes, isBuffer, isBytes', (t: any) =>{
    let buf = Buffer.from([1]);
    let bytes = Uint8Array.from([1]);
    let other = [1, 2, 3];

    t.same(identifyBufOrBytes(buf), 'buffer', 'can identify Buffer');
    t.same(isBuffer(buf), true, 'isBuffer true');
    t.same(isBytes(buf), false, 'isBytes false');

    t.same(identifyBufOrBytes(bytes), 'bytes', 'can identify bytes');
    t.same(isBuffer(bytes), false, 'isBuffer false');
    t.same(isBytes(bytes), true, 'isBytes true');

    t.same(identifyBufOrBytes(other as any), '?', 'is not tricked by other kinds of object');
    t.same(isBuffer(other), false, 'isBuffer false on other');
    t.same(isBytes(other), false, 'isBytes false on other');

    t.end();
});