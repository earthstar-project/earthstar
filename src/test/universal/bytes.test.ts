import t = require('tap');
import { onFinishOneTest } from '../browser-run-exit';
import { snowmanString, snowmanBytes } from '../test-utils';
//t.runOnly = true;

let TEST_NAME = 'bytes';

// Boilerplate to help browser-run know when this test is completed.
// When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function.
/* istanbul ignore next */ 
(t.test as any)?.onFinish?.(() => onFinishOneTest(TEST_NAME));

import {
    bytesToString,
    concatBytes,
    identifyBufOrBytes,
    isBytes,
    isBuffer,
    stringLengthInBytes,
    stringToBytes,
} from '../../util/bytes';

//================================================================================

let simpleString = 'aa';
let simpleBytes = Uint8Array.from([97, 97]);

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

t.test('bytes: identifyBufOrBytes, isBuffer, isBytes', (t: any) =>{
    let bytes = Uint8Array.from([1]);
    let other = [1, 2, 3];

    t.same(identifyBufOrBytes(bytes), 'bytes', 'can identify bytes');
    t.same(isBuffer(bytes), false, 'isBuffer false');
    t.same(isBytes(bytes), true, 'isBytes true');

    t.same(identifyBufOrBytes(other as any), '?', 'is not tricked by other kinds of object');
    t.same(isBuffer(other), false, 'isBuffer false on other');
    t.same(isBytes(other), false, 'isBytes false on other');

    t.end();
});