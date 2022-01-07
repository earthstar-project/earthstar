import { assert, assertEquals } from "../asserts.ts";

let TEST_NAME = "compare";

import { Cmp } from "../../storage/util-types.ts";
import {
    compareArrays,
    compareBasic,
    compareByFn,
    compareByObjArrayFn,
    compareByObjKey,
    SortOrder,
} from "../../storage/compare.ts";

//================================================================================

Deno.test("compareBasic", () => {
    type Vector = [
        a: any,
        result: any,
        b: any,
        sortOrder: SortOrder | undefined,
        note?: string,
    ];
    let vectors: Vector[] = [
        [1, Cmp.LT, 2, undefined],
        [2, Cmp.EQ, 2, undefined],
        [2, Cmp.GT, 1, undefined],
        [["a"], Cmp.EQ, ["a"], undefined, "deep equal"],
        [1, Cmp.LT, 2, "ASC"],
        [2, Cmp.EQ, 2, "ASC"],
        [2, Cmp.GT, 1, "ASC"],
        [1, Cmp.GT, 2, "DESC"],
        [2, Cmp.EQ, 2, "DESC"],
        [2, Cmp.LT, 1, "DESC"],
    ];
    for (let [a, expectedResult, b, sortOrder, note] of vectors) {
        note = note ? `   (${note})` : "";
        let actualResult = compareBasic(a, b, sortOrder);
        assertEquals(
            actualResult,
            expectedResult,
            `baseCompare(${a}, ${b}) should === ${expectedResult} ${note}`,
        );
    }
    assertEquals(compareBasic(1, 2), Cmp.LT, "works with omitted sortOrder");

    let x = [1, 2, 5, 3, 4, 2];
    x.sort(compareBasic);
    assertEquals(x, [1, 2, 2, 3, 4, 5], "sort(baseCompare)");
    x.sort((a, b) => compareBasic(a, b, "DESC"));
    assertEquals(x, [5, 4, 3, 2, 2, 1], "sort(baseCompare) DESC");
});

Deno.test("compareArrays", () => {
    type Vector = [
        a: any[],
        result: Cmp,
        b: any[],
        sortOrders: SortOrder[] | undefined,
        note?: string,
    ];
    let vectors: Vector[] = [
        // one element: compare the element
        [[1], Cmp.LT, [2], undefined],
        [[2], Cmp.EQ, [2], undefined],
        [[2], Cmp.GT, [1], undefined],

        // shorter array wins
        [[3, 3], Cmp.LT, [3, 3, 3], undefined],
        [[3, 3], Cmp.EQ, [3, 3], undefined],
        [[3, 3], Cmp.GT, [3], undefined],

        // first item is more important
        [[3, 3], Cmp.EQ, [3, 3], undefined],

        [[3, 3], Cmp.LT, [4, 3], undefined],
        [[3, 3], Cmp.GT, [2, 3], undefined],

        [[3, 3], Cmp.LT, [3, 4], undefined],
        [[3, 3], Cmp.GT, [3, 2], undefined],

        [[3, 3], Cmp.LT, [4, 2], undefined],
        [[3, 3], Cmp.GT, [2, 4], undefined],

        [[["a"]], Cmp.EQ, [["a"]], undefined, "deep equal"],

        // sort orders
        [[3, 30, 300], Cmp.EQ, [3, 30, 300], ["ASC"]],
        [[3, 30, 300], Cmp.EQ, [3, 30, 300], ["DESC"]],
        [[3, 30, 300], Cmp.EQ, [3, 30, 300], ["DESC", "DESC"]],
        [[3, 30, 300], Cmp.EQ, [3, 30, 300], ["DESC", "DESC", "DESC"]],
        [[3, 30, 300], Cmp.EQ, [3, 30, 300], ["DESC", "DESC", "DESC", "DESC"]],

        [[3, 30, 300], Cmp.LT, [4, 40, 400], ["ASC"]],
        [[3, 30, 300], Cmp.LT, [4, 40, 400], ["ASC", "ASC"]],
        [[3, 30, 300], Cmp.LT, [4, 40, 400], ["ASC", "ASC", "ASC"]],
        [[3, 30, 300], Cmp.LT, [4, 40, 400], ["ASC", "ASC", "ASC", "ASC"]],
        [[3, 30, 300], Cmp.GT, [4, 40, 400], ["DESC"]],
        [[3, 30, 300], Cmp.GT, [4, 40, 400], ["DESC", "DESC"]],
        [[3, 30, 300], Cmp.GT, [4, 40, 400], ["DESC", "DESC", "DESC"]],
        [[3, 30, 300], Cmp.GT, [4, 40, 400], ["DESC", "DESC", "DESC", "DESC"]],

        [[6, 7, 7], Cmp.LT, [7, 7, 7], ["ASC", "ASC", "ASC"]],
        [[8, 7, 7], Cmp.LT, [7, 7, 7], ["DESC", "ASC", "ASC"]],
        [[7, 6, 7], Cmp.LT, [7, 7, 7], ["ASC", "ASC", "ASC"]],
        [[7, 8, 7], Cmp.LT, [7, 7, 7], ["ASC", "DESC", "ASC"]],
        [[7, 7, 6], Cmp.LT, [7, 7, 7], ["ASC", "ASC", "ASC"]],
        [[7, 7, 8], Cmp.LT, [7, 7, 7], ["ASC", "ASC", "DESC"]],

        [
            [1],
            Cmp.LT,
            [1, 1, 1],
            ["ASC"],
            "different lengths with short sortOrder array",
        ],
        [
            [1],
            Cmp.LT,
            [1, 1, 1],
            ["DESC"],
            "different lengths with short sortOrder array",
        ],
        [
            [2],
            Cmp.GT,
            [1, 1, 1],
            ["ASC"],
            "different lengths with short sortOrder array",
        ],
        [
            [2],
            Cmp.LT,
            [1, 1, 1],
            ["DESC"],
            "different lengths with short sortOrder array",
        ],

        [[1], Cmp.LT, [1, 1, 1], ["ASC", "ASC"], "different lengths with ASC"],
        [
            [1],
            Cmp.GT,
            [1, 1, 1],
            ["ASC", "DESC"],
            "different lengths with DESC",
        ],
    ];
    for (let [a, expectedResult, b, sortOrders, note] of vectors) {
        note = note ? `   (${note})` : "";
        let actualResult = compareArrays(a, b, sortOrders);
        assertEquals(
            actualResult,
            expectedResult,
            `arrayCompare(${a}, ${b}) should === ${expectedResult} ${note}`,
        );
    }
    assertEquals(
        compareArrays([1], [2]),
        Cmp.LT,
        "works with omitted sortOrders",
    );

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
    assertEquals(arrToSort, expectedSortedArr, "sort(arrayCompare)");

    expectedSortedArr = [
        [2],
        [2, 99],
        [2, 99, 1],
        [1],
        [1, 1],
        [1, 1, 99],
        [1, 2],
        [1, 2],
    ];
    arrToSort.sort((a, b) => compareArrays(a, b, ["DESC"])); // desc by first element, asc by the rest
    assertEquals(arrToSort, expectedSortedArr, 'sort(arrayCompare) ["DESC"]');

    expectedSortedArr = [
        [2, 99, 1],
        [2, 99],
        [2],
        [1, 2],
        [1, 2],
        [1, 1, 99],
        [1, 1],
        [1],
    ];
    arrToSort.sort((a, b) => compareArrays(a, b, ["DESC", "DESC", "DESC"])); // desc overall, shorter arrays last
    assertEquals(
        arrToSort,
        expectedSortedArr,
        'sort(arrayCompare) ["DESC", "DESC", "DESC"]',
    );
});

Deno.test("compareByObjKey", () => {
    type Vector = [
        a: Record<string, any>,
        result: any,
        b: Record<string, any>,
        sortOrder: SortOrder | undefined,
        note?: string,
    ];
    let vectors: Vector[] = [
        [{ foo: 1 }, Cmp.LT, { foo: 2 }, undefined],
        [{ foo: 2 }, Cmp.EQ, { foo: 2 }, undefined],
        [{ foo: 3 }, Cmp.GT, { foo: 2 }, undefined],

        [{ foo: 1 }, Cmp.LT, { foo: 2 }, "ASC"],
        [{ foo: 2 }, Cmp.EQ, { foo: 2 }, "ASC"],
        [{ foo: 3 }, Cmp.GT, { foo: 2 }, "ASC"],

        [{ foo: 1 }, Cmp.GT, { foo: 2 }, "DESC"],
        [{ foo: 2 }, Cmp.EQ, { foo: 2 }, "DESC"],
        [{ foo: 3 }, Cmp.LT, { foo: 2 }, "DESC"],

        [{ foo: ["a"] }, Cmp.EQ, { foo: ["a"] }, undefined, "deep equal"],
    ];
    for (let [a, expectedResult, b, sortOrder, note] of vectors) {
        note = note ? `   (${note})` : "";
        let actualResult = compareByObjKey("foo", sortOrder)(a, b);
        assertEquals(
            actualResult,
            expectedResult,
            `keyComparer('foo')(${a}, ${b}) should === ${expectedResult} ${note}`,
        );
    }
    assertEquals(
        compareByObjKey("foo")({ foo: 1 }, { foo: 2 }),
        Cmp.LT,
        "works with omitted sortOrder",
    );
});

Deno.test("compareByFn", () => {
    type Vector = [
        a: any,
        result: any,
        b: any,
        fn: (x: any) => any,
        note?: string,
    ];
    let vectors: Vector[] = [
        [1, Cmp.LT, 2, (x) => x, "identity"],
        [2, Cmp.EQ, 2, (x) => x, "identity"],
        [3, Cmp.GT, 2, (x) => x, "identity"],

        [["a"], Cmp.EQ, ["a"], (x) => x, "identity (deep equal)"],

        [1, Cmp.GT, 2, (x) => -x, "negate"],
        [2, Cmp.EQ, 2, (x) => -x, "negate"],
        [3, Cmp.LT, 2, (x) => -x, "negate"],
    ];
    for (let [a, expectedResult, b, fn, note] of vectors) {
        note = note ? `   (${note})` : "";
        let actualResult = compareByFn(fn)(a, b);
        assertEquals(
            actualResult,
            expectedResult,
            `keyComparer('foo')(${a}, ${b}) should === ${expectedResult} ${note}`,
        );
    }
});

Deno.test("compareByObjArrayFn", () => {
    type Vector = [
        a: any,
        result: any,
        b: any,
        fn: (x: any) => any,
        note?: string,
    ];
    let vectors: Vector[] = [
        [
            { foo: 0, bar: 3 },
            Cmp.LT,
            { foo: 1, bar: 2 },
            (x) => [x.foo, x.bar],
            "foo, bar",
        ],
        [
            { foo: 1, bar: 1 },
            Cmp.LT,
            { foo: 1, bar: 2 },
            (x) => [x.foo, x.bar],
            "foo, bar",
        ],
        [
            { foo: 1, bar: 2 },
            Cmp.EQ,
            { foo: 1, bar: 2 },
            (x) => [x.foo, x.bar],
            "foo, bar",
        ],
        [
            { foo: 2, bar: 0 },
            Cmp.GT,
            { foo: 1, bar: 2 },
            (x) => [x.foo, x.bar],
            "foo, bar",
        ],
        [
            { foo: 1, bar: 3 },
            Cmp.GT,
            { foo: 1, bar: 2 },
            (x) => [x.foo, x.bar],
            "foo, bar",
        ],
    ];
    for (let [a, expectedResult, b, fn, note] of vectors) {
        note = note ? `   (${note})` : "";
        let actualResult = compareByObjArrayFn(fn)(a, b);
        assertEquals(
            actualResult,
            expectedResult,
            `keyComparer('foo')(${a}, ${b}) should === ${expectedResult} ${note}`,
        );
    }
});
