import t from 'tap';
// Boilerplate to help browser-run know when this test is completed (see browser-run.ts)
// When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function..
declare let window: any;
if ((t.test as any).onFinish) {
    (t.test as any).onFinish(() => window.onFinish('base32'));
}

import {
    base32StringToBytes,
    base32BytesToString,
} from '../crypto/base32';
import {
    hexStringToBytes
} from '../util/bytes';

//================================================================================ 

t.test('base32 encoding', (t: any) => {
    let bytes = Uint8Array.from([1, 2, 3, 4, 5]);
    let str = base32BytesToString(bytes);
    let bytes2 = base32StringToBytes(str);
    let str2 = base32BytesToString(bytes2);

    t.true(bytes2 instanceof Uint8Array, 'decoding creates a Uint8Array');

    t.same(bytes, bytes2, 'bytes roundtrip to base32');
    t.same(str, str2, 'base32 roundtrip to bytes');
    t.ok(str.startsWith('b'), 'base32 startswith b');

    t.same(base32BytesToString(Uint8Array.from([])), 'b', 'base32 can encode Uint8Array([]) to "b"');
    t.same(base32BytesToString(Uint8Array.from([0])), 'baa', 'base32 can encode Uint8Array([0]) to "baa"');

    t.same(base32StringToBytes('b'), Uint8Array.from([]), 'base32 can decode just the string "b" to an empty Uint8Array');
    t.same(base32StringToBytes('baa'), Uint8Array.from([0]), 'base32 can decode the string "baa" to Uint8Array([0])');

    t.throws(() => base32StringToBytes(''), 'decoding base32 throws an exception if string is empty');
    t.throws(() => base32StringToBytes('abc'), 'decoding base32 throws an exception when it does not start with "b"');
    t.throws(() => base32StringToBytes('b123'), 'decoding base32 throws when encountering invalid base32 character');
    t.throws(() => base32StringToBytes('babc?xyz'), 'decoding base32 throws when encountering invalid base32 character');
    t.throws(() => base32StringToBytes('babc xyz'), 'decoding base32 throws when encountering invalid base32 character');
    t.throws(() => base32StringToBytes('b abcxyz'), 'decoding base32 throws when encountering invalid base32 character');
    t.throws(() => base32StringToBytes('babcxyz '), 'decoding base32 throws when encountering invalid base32 character');
    t.throws(() => base32StringToBytes('babcxyz\n'), 'decoding base32 throws when encountering invalid base32 character');
    t.throws(() => base32StringToBytes('BABC'), 'decoding base32 throws when encountering a different multibase encoding');
    t.throws(() => base32StringToBytes('b???'), 'decoding base32 throws on "b???"');
    t.throws(() => base32StringToBytes('b11'), 'decoding base32 throws on "b11"');

    // make sure we have a multibase version that fixed this bug:
    // https://github.com/multiformats/js-multibase/issues/17
    let exampleBytes = hexStringToBytes('1220120f6af601d46e10b2d2e11ed71c55d25f3042c22501e41d1246e7a1e9d3d8ec');
    let exampleString = 'bciqbed3k6ya5i3qqwljochwxdrk5exzqilbckapedujenz5b5hj5r3a';
    t.same(base32BytesToString(exampleBytes), exampleString, 'edge case works');

    let bytes_11 = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    let str_11_correct = 'baebagbafaydqqcikbm';
    let str_11_loose1 = 'baebagbafaydqqc1kbm';  // i to 1
    let str_11_loose2 = 'baebagbafaydqqcikbM';  // uppercase M at end
    t.same(base32BytesToString(bytes_11), str_11_correct, 'encodes bytes to correct string');
    t.same(base32StringToBytes(str_11_correct), bytes_11, 'decodes string to correct bytes');
    t.throws(() => base32StringToBytes(str_11_loose1), 'throws on loose string (i vs 1)');
    t.throws(() => base32StringToBytes(str_11_loose2), 'throws on loose string (case change)');

    let padded_b32 = 'baa======';
    let unpadded_b32 = 'baa';
    let matching_buf = Uint8Array.from([0]);

    t.same(base32StringToBytes(unpadded_b32), matching_buf, 'unpadded base32 is handled ok');
    t.throws(() => base32StringToBytes(padded_b32), 'padded base32 is not allowed');

    t.end();
});
