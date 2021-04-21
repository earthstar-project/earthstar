import t = require('tap');
//t.runOnly = true;

import {
    bytesToString,
    stringLengthInBytes,
    stringToBytes,
} from '../util/bytes';

//================================================================================

// use this unicode character for testing
let snowmanString = '\u2603';  // ☃ \u2603  [0xe2, 0x98, 0x83] -- 3 bytes
let snowmanBytes = Uint8Array.from([0xe2, 0x98, 0x83]);

let simpleString = 'aa';
let simpleBytes = Uint8Array.from([97, 97]);

//================================================================================

t.test('bytesToString', (t: any) => {
    t.same(bytesToString(simpleBytes), simpleString, 'simple bytes to string');
    t.same(bytesToString(snowmanBytes), snowmanString, 'snowman bytes to string');
    t.end();
});

t.test('stringToBytes', (t: any) => {
    t.same(stringToBytes(simpleString), simpleBytes, 'simple string to bytes');
    t.same(stringToBytes(snowmanString), snowmanBytes, 'snowman string to bytes');
    t.end();
});

t.test('stringLengthInBytes', (t: any) =>{
    t.same(stringLengthInBytes(simpleString), 2, 'simple string');
    t.same(stringLengthInBytes(snowmanString), 3, 'snowman string');
    t.end();
});
