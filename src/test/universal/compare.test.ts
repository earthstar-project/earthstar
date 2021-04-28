import t = require('tap');
// Boilerplate to help browser-run know when this test is completed (see browser-run.ts)
// When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function..
declare let window: any;
if ((t.test as any).onFinish) {
    (t.test as any).onFinish(() => window.onFinish('compare'));
}

import { Cmp } from '../../storage/util-types';
import {
    compareArrays,
    compareBasic,
    compareByFn,
    compareByObjArrayFn,
    compareByObjKey,
} from '../../storage/compare';

//================================================================================

// use this unicode character for testing
let snowmanString = '\u2603';  // ☃ \u2603  [0xe2, 0x98, 0x83] -- 3 bytes

//================================================================================

t.test('compareBasic', (t: any) => {
    type Vector = [a: any, result: any, b: any, note?: string];
    let vectors: Vector[] = [
        [1, Cmp.LT, 2],
        [2, Cmp.EQ, 2],
        [2, Cmp.GT, 1],
        [['a'], Cmp.EQ, ['a'], 'deep equal'],
    ];
    for (let [a, expectedResult, b, note] of vectors) {
        note = note ? `   (${note})` : '';
        let actualResult = compareBasic(a, b);
        t.same(actualResult, expectedResult, `baseCompare(${a}, ${b}) should === ${expectedResult} ${note}`);
    }

    let x = [1, 2, 5, 3, 4, 2];
    x.sort(compareBasic);
    t.same(x, [1, 2, 2, 3, 4, 5], 'sort(baseCompare)');

    t.end();
});

t.test('compareArrays', (t: any) => {
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

        [ [['a']], Cmp.EQ, [['a']], 'deep equal'],
    ];
    for (let [a, expectedResult, b, note] of vectors) {
        note = note ? `   (${note})` : '';
        let actualResult = compareArrays(a, b);
        t.same(actualResult, expectedResult, `arrayCompare(${a}, ${b}) should === ${expectedResult} ${note}`);
    }

    let arrToSort = [
        [1, 1],
        [2],
        [1],
        [2, 99, 1],
        [1, 2],
        [1, 1, 99],
        [2, 99],
        [1, 2],
    ];
    let expectedSortedArr = [
        [1],
        [1, 1],
        [1, 1, 99],
        [1, 2],
        [1, 2],
        [2],
        [2, 99],
        [2, 99, 1],
    ];
    arrToSort.sort(compareArrays);
    t.same(arrToSort, expectedSortedArr, 'sort(arrayCompare)');

    t.end();
});

t.test('compareByObjKey', (t: any) => {
    type Vector = [a: Record<string, any>, result: any, b: Record<string, any>, note?: string];
    let vectors: Vector[] = [
        [ { foo: 1 }, Cmp.LT, { foo: 2 } ],
        [ { foo: 2 }, Cmp.EQ, { foo: 2 } ],
        [ { foo: 3 }, Cmp.GT, { foo: 2 } ],

        [ { foo: ['a'] }, Cmp.EQ, { foo: ['a'] }, 'deep equal' ],
    ];
    for (let [a, expectedResult, b, note] of vectors) {
        note = note ? `   (${note})` : '';
        let actualResult = compareByObjKey('foo')(a, b);
        t.same(actualResult, expectedResult, `keyComparer('foo')(${a}, ${b}) should === ${expectedResult} ${note}`);
    }

    t.end();
});

t.test('compareByFn', (t: any) => {
    type Vector = [a: any, result: any, b: any, fn: (x: any) => any, note?: string];
    let vectors: Vector[] = [
        [1, Cmp.LT, 2, (x) => x, 'identity'],
        [2, Cmp.EQ, 2, (x) => x, 'identity'],
        [3, Cmp.GT, 2, (x) => x, 'identity'],

        [['a'], Cmp.EQ, ['a'], (x) => x, 'identity (deep equal)'],

        [1, Cmp.GT, 2, (x) => -x, 'negate'],
        [2, Cmp.EQ, 2, (x) => -x, 'negate'],
        [3, Cmp.LT, 2, (x) => -x, 'negate'],
    ];
    for (let [a, expectedResult, b, fn, note] of vectors) {
        note = note ? `   (${note})` : '';
        let actualResult = compareByFn(fn)(a, b);
        t.same(actualResult, expectedResult, `keyComparer('foo')(${a}, ${b}) should === ${expectedResult} ${note}`);
    }

    t.end();
});

t.test('compareByObjArrayFn', (t: any) => {
    type Vector = [a: any, result: any, b: any, fn: (x: any) => any, note?: string];
    let vectors: Vector[] = [
        [ { foo: 0, bar: 3 }, Cmp.LT, { foo: 1, bar: 2 }, (x) => [x.foo, x.bar], 'foo, bar'],
        [ { foo: 1, bar: 1 }, Cmp.LT, { foo: 1, bar: 2 }, (x) => [x.foo, x.bar], 'foo, bar'],
        [ { foo: 1, bar: 2 }, Cmp.EQ, { foo: 1, bar: 2 }, (x) => [x.foo, x.bar], 'foo, bar'],
        [ { foo: 2, bar: 0 }, Cmp.GT, { foo: 1, bar: 2 }, (x) => [x.foo, x.bar], 'foo, bar'],
        [ { foo: 1, bar: 3 }, Cmp.GT, { foo: 1, bar: 2 }, (x) => [x.foo, x.bar], 'foo, bar'],
    ];
    for (let [a, expectedResult, b, fn, note] of vectors) {
        note = note ? `   (${note})` : '';
        let actualResult = compareByObjArrayFn(fn)(a, b);
        t.same(actualResult, expectedResult, `keyComparer('foo')(${a}, ${b}) should === ${expectedResult} ${note}`);
    }

    t.end();
});
