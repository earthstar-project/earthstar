import { isDeep } from 'tap';
import t = require('tap');
// Boilerplate to help browser-run know when this test is completed (see browser-run.ts)
// When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function..
declare let window: any;
if ((t.test as any).onFinish) {
    (t.test as any).onFinish(() => window.onFinish('characters'));
}

import {
    alphaLower,
    isDigit,
    isOnlyPrintableAscii,
    onlyHasChars,
} from '../core-validators/characters';
import { bytesToString } from '../util/bytes';

//================================================================================

// use this unicode character for testing
let snowmanString = '\u2603';  // ☃ \u2603  [0xe2, 0x98, 0x83] -- 3 bytes

//================================================================================

t.test('onlyHasCharacters', (t: any) => {
    type Vector = [str: string, allowedChars: string, result: boolean];
    let vectors: Vector[] = [
        ['a', 'a', true],
        ['abc', 'a', false],
        ['a', 'abc', true],
        ['', 'abc', true],
        ['abc', '', false],
        ['helloworld', alphaLower, true],
        ['helloWorld', alphaLower, false],
        [snowmanString, snowmanString, true],
        [snowmanString, 'a', false],
        ['a', snowmanString, false],
        [snowmanString, 'abc' + snowmanString + 'def', true],
        ['a' + snowmanString + 'a', 'abc' + snowmanString + 'def', true],
    ];
    for (let [str, allowedChars, expectedResult] of vectors) {
        t.same(onlyHasChars(str, allowedChars), expectedResult, `onlyHasChars("${str}", "${allowedChars}") should === ${expectedResult}`);
    }
    t.end();
});

t.test('isOnlyPrintableAscii', (t: any) => {
    type Vector = [ch: string, result: boolean];
    let vectors: Vector[] = [
        ['hello', true],
        [' ', true],
        ['', true],
        ['\n', false],
        ['\t', false],
        ['\x00', false],
        [snowmanString, false],
        [bytesToString(Uint8Array.from([200])), false],
        [bytesToString(Uint8Array.from([127])), false],
        [bytesToString(Uint8Array.from([126])), true],
        [bytesToString(Uint8Array.from([55, 127])), false],
        [bytesToString(Uint8Array.from([55, 126])), true],
        [bytesToString(Uint8Array.from([32])), true],
        [bytesToString(Uint8Array.from([31])), false],
        [bytesToString(Uint8Array.from([0])), false],
    ];
    for (let [str, expectedResult] of vectors) {
        t.same(isOnlyPrintableAscii(str), expectedResult, `isOnlyPrintableAscii("${str}") should === ${expectedResult}`);
    }
    t.end();
});

t.test('isDigit', (t: any) => {
    type Vector = [ch: string, result: boolean];
    let vectors: Vector[] = [
        ['0', true],
        ['1', true],
        ['2', true],
        ['3', true],
        ['4', true],
        ['5', true],
        ['6', true],
        ['7', true],
        ['8', true],
        ['9', true],

        ['a', false],
        [' ', false],
        ['', false],
        ['00', false],  // only one digit at a time
        ['0.0', false],
    ];
    for (let [ch, expectedResult] of vectors) {
        t.same(isDigit(ch), expectedResult, `isDigit("${ch}") should === ${expectedResult}`);
    }
    t.end();
});
