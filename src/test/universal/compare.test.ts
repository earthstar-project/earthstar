import t = require('tap');
// Boilerplate to help browser-run know when this test is completed (see browser-run.ts)
// When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function..
declare let window: any;
if ((t.test as any).onFinish) {
    (t.test as any).onFinish(() => window.onFinish('compare'));
}

import { Cmp } from '../../storage/util-types';
import { arrayCompare, baseCompare } from '../../storage/compare';

//================================================================================

// use this unicode character for testing
let snowmanString = '\u2603';  // ☃ \u2603  [0xe2, 0x98, 0x83] -- 3 bytes

//================================================================================

t.test('baseCompare', (t: any) => {
    type Vector = [a: any, result: any, b: any, note?: string];
    let vectors: Vector[] = [
        [1, Cmp.LT, 2],
        [2, Cmp.EQ, 2],
        [2, Cmp.GT, 1],
    ];
    for (let [a, expectedResult, b, note] of vectors) {
        note = note ? `   (${note})` : '';
        let actualResult = baseCompare(a, b);
        t.same(actualResult, expectedResult, `baseCompare(${a}, ${b}) should === ${expectedResult} ${note}`);
    }

    let x = [1, 2, 5, 3, 4, 2];
    x.sort(baseCompare);
    t.same(x, [1, 2, 2, 3, 4, 5], 'sort(baseCompare)');

    t.end();
});

t.test('arrayCompare', (t: any) => {
    type Vector = [a: any[], result: Cmp, b: any[], note?: string];
    let vectors: Vector[] = [
        // one element: compare the element
        [ [1], Cmp.LT, [2] ],
        [ [2], Cmp.EQ, [2] ],
        [ [2], Cmp.GT, [1] ],

        // shorter array wins
        [ [3, 3], Cmp.LT, [3, 3, 3] ],
        [ [3, 3], Cmp.EQ, [3, 3] ],
        [ [3, 3], Cmp.GT, [3] ],

        // first item is more important
        [ [3, 3], Cmp.EQ, [3, 3] ],

        [ [3, 3], Cmp.LT, [4, 3] ],
        [ [3, 3], Cmp.GT, [2, 3] ],

        [ [3, 3], Cmp.LT, [3, 4] ],
        [ [3, 3], Cmp.GT, [3, 2] ],

        [ [3, 3], Cmp.LT, [4, 2] ],
        [ [3, 3], Cmp.GT, [2, 4] ],
    ];
    for (let [a, expectedResult, b, note] of vectors) {
        note = note ? `   (${note})` : '';
        let actualResult = arrayCompare(a, b);
        t.same(actualResult, expectedResult, `arrayCompare(${a}, ${b}) should === ${expectedResult} ${note}`);
    }

    let unsortedArr = [
        [1, 1],
        [2],
        [1],
        [2, 99, 1],
        [1, 2],
        [1, 1, 99],
        [2, 99],
        [1, 2],
    ];
    let sortedArr = [
        [1],
        [1, 1],
        [1, 1, 99],
        [1, 2],
        [1, 2],
        [2],
        [2, 99],
        [2, 99, 1],
    ];
    unsortedArr.sort(arrayCompare);
    t.same(unsortedArr, sortedArr, 'sort(arrayCompare)');

    t.end();
});
