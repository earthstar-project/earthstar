import t = require('tap');
//t.runOnly = true;

import {
    base32StringToBuffer,
    bufferToBase32String,
} from '../base32';

//================================================================================ 
// LOGGING

let log = console.log;
//let log = (...args: any[]) => {};

//================================================================================ 

t.test('base32 encoding', (t: any) => {
    let buf = Buffer.from([1, 2, 3, 4, 5]);
    let b32 = bufferToBase32String(buf);
    let buf2 = base32StringToBuffer(b32);
    let b32_2 = bufferToBase32String(buf2);

    t.true(buf2 instanceof Buffer, 'decoding creates a Buffer');

    t.same(buf, buf2, 'buffer roundtrip to base32');
    t.same(b32, b32_2, 'base32 roundtrip to buffer');
    t.ok(b32.startsWith('b'), 'base32 startswith b');

    t.same(bufferToBase32String(Buffer.from([])), 'b', 'base32 can encode Buffer([]) to "b"');
    t.same(bufferToBase32String(Buffer.from([0])), 'baa', 'base32 can encode Buffer([0]) to "baa"');

    t.same(base32StringToBuffer('b'), Buffer.from([]), 'base32 can decode just the string "b" to an empty buffer');
    t.same(base32StringToBuffer('baa'), Buffer.from([0]), 'base32 can decode the string "baa" to Buffer([0])');

    t.throws(() => base32StringToBuffer(''), 'decoding base32 throws an exception if string is empty');
    t.throws(() => base32StringToBuffer('abc'), 'decoding base32 throws an exception when it does not start with "b"');
    t.throws(() => base32StringToBuffer('b123'), 'decoding base32 throws when encountering invalid base32 character');
    t.throws(() => base32StringToBuffer('babc?xyz'), 'decoding base32 throws when encountering invalid base32 character');
    t.throws(() => base32StringToBuffer('babc xyz'), 'decoding base32 throws when encountering invalid base32 character');
    t.throws(() => base32StringToBuffer('b abcxyz'), 'decoding base32 throws when encountering invalid base32 character');
    t.throws(() => base32StringToBuffer('babcxyz '), 'decoding base32 throws when encountering invalid base32 character');
    t.throws(() => base32StringToBuffer('babcxyz\n'), 'decoding base32 throws when encountering invalid base32 character');
    t.throws(() => base32StringToBuffer('BABC'), 'decoding base32 throws when encountering a different multibase encoding');
    t.throws(() => base32StringToBuffer('b???'), 'decoding base32 throws on "b???"');
    t.throws(() => base32StringToBuffer('b11'), 'decoding base32 throws on "b11"');

    // make sure we have a multibase version that fixed this bug:
    // https://github.com/multiformats/js-multibase/issues/17
    let raw = Buffer.from('1220120f6af601d46e10b2d2e11ed71c55d25f3042c22501e41d1246e7a1e9d3d8ec', 'hex');
    let expected = 'bciqbed3k6ya5i3qqwljochwxdrk5exzqilbckapedujenz5b5hj5r3a';
    t.same(bufferToBase32String(raw), expected, 'edge case works');

    let buf_11 = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    let b32_11_correct = 'baebagbafaydqqcikbm';
    let b32_11_loose1 = 'baebagbafaydqqc1kbm';  // i to 1
    let b32_11_loose2 = 'baebagbafaydqqcikbM';  // uppercase M at end
    t.same(bufferToBase32String(buf_11), b32_11_correct, 'encodes to correct b32 string');
    t.same(base32StringToBuffer(b32_11_correct), buf_11, 'decodes b32 to correct buffer');
    t.throws(() => base32StringToBuffer(b32_11_loose1), 'throws on loose b32 string (i vs 1)');
    t.throws(() => base32StringToBuffer(b32_11_loose2), 'throws on loose b32 string (case change)');

    let padded_b32 = 'baa======';
    let unpadded_b32 = 'baa';
    let matching_buf = Buffer.from([0]);

    t.same(base32StringToBuffer(unpadded_b32), matching_buf, 'unpadded base32 is handled ok');
    t.throws(() => base32StringToBuffer(padded_b32), 'padded base32 is not allowed');

    t.end();
});
