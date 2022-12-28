import { assert, assertEquals } from "../asserts.ts";

import { snowmanString } from "../test-utils.ts";

let TEST_NAME = "checkers";

import {
  checkInt,
  CheckIntOpts,
  checkIsPlainObject,
  checkLiteral,
  checkString,
  CheckStringOpts,
  isPlainObject,
} from "../../core-validators/checkers.ts";

//================================================================================

class TestClass {
}

let J = JSON.stringify;

Deno.test("isPlainObject", () => {
  type Vector = [result: boolean, obj: any, note?: string];
  let vectors: Vector[] = [
    [true, {}, "empty object"],
    [true, { 1: "a" }],
    [true, { a: "b" }],
    [true, Object.freeze({ a: "b" })],

    [false, 123],
    [false, NaN],
    [false, "hi"],
    [false, []],
    [false, [123]],
    [false, new Set(), "set"],
    [false, new Map(), "map"],
    [false, new TestClass(), "class instance"],
  ];
  for (let [expectedResult, obj, note] of vectors) {
    note = note ? `   (${note})` : "";
    assertEquals(
      isPlainObject(obj),
      expectedResult,
      `isPlainObj(${J(obj)}) should === ${expectedResult} ${note}`,
    );
    if (expectedResult === true) {
      assertEquals(checkIsPlainObject(obj), null);
    } else {
      assert(typeof checkIsPlainObject(obj) === "string");
    }
  }
});

Deno.test("checkLiteral", () => {
  type Vector = [result: boolean, x1: any, x2: any, note?: string];
  let obj = { a: 1 };
  let vectors: Vector[] = [
    [true, 1, 1],
    [true, "a", "a"],
    [true, null, null],
    [true, undefined, undefined],
    [true, true, true],
    [true, false, false],

    [true, obj, obj, "reference equality"],
    [false, obj, { ...obj }, "only deep equality"],

    [false, 1, 0],
    [false, null, undefined],
    [false, "", undefined],
    [false, "", 0],
    [false, undefined, 0],
    [false, undefined, []],
    [false, false, null],
    [false, false, undefined],
  ];
  for (let [expectedResult, x1, x2, note] of vectors) {
    note = note ? `   (${note})` : "";
    let msg = `${x1} matches ${x2} ? ${expectedResult} ${note}`;
    if (expectedResult === true) {
      assertEquals(checkLiteral(x1)(x2), null, msg);
    } else {
      assert(typeof checkLiteral(x1)(x2) === "string", msg);
    }
  }
});

Deno.test("checkString", () => {
  type Vector = [
    result: boolean,
    str: any,
    opts: CheckStringOpts | undefined,
    note?: string,
  ];
  let vectors: Vector[] = [
    [false, 123, {}],
    [false, NaN, {}],
    [false, -NaN, {}],
    [false, Infinity, {}],
    [false, -Infinity, {}],
    [false, null, {}],
    [false, undefined, {}],
    [false, true, {}],
    [false, false, {}],
    [false, ["a"], {}],
    [false, { a: 1 }, {}],
    [false, new Set(), {}],
    [false, new Map(), {}],
    [false, new TestClass(), {}],

    [true, "hello", {}],

    [true, "hello", { minLen: 4 }],
    [true, "hello", { minLen: 5 }],
    [false, "hello", { minLen: 6 }],

    [false, "hello", { maxLen: 4 }],
    [true, "hello", { maxLen: 5 }],
    [true, "hello", { maxLen: 6 }],

    [false, "hello", { len: 4 }],
    [true, "hello", { len: 5 }],
    [false, "hello", { len: 6 }],

    [true, "hello", { minLen: 5, maxLen: 5 }],
    [true, "hello", { minLen: 4, maxLen: 6 }],

    [true, "", { minLen: 0 }],
    [true, "", { len: 0 }],
    [false, "", { minLen: 1 }],
    [false, "", { len: 1 }],

    [true, "", { allowedChars: "abc" }],
    [true, "abc", { allowedChars: "abc" }],
    [true, "abc", { allowedChars: "abcdef" }],
    [false, "abcdef", { allowedChars: "abc" }],

    [true, "abc", { allowedChars: "abcd", minLen: 2, maxLen: 4 }],
    [false, "abc", { allowedChars: "a", minLen: 2, maxLen: 4 }],
    [false, "abc", { allowedChars: "abcd", minLen: 4, maxLen: 4 }],
    [false, "abc", { allowedChars: "abcd", minLen: 2, maxLen: 2 }],
    [true, "abc", { allowedChars: "abcd", len: 3 }],
    [false, "abc", { allowedChars: "abcd", len: 4 }],

    [true, "abc", { optional: true, allowedChars: "abcd", len: 3 }],
    [true, "abc", { optional: false, allowedChars: "abcd", len: 3 }],
    [true, undefined, { optional: true, allowedChars: "abcd", len: 3 }],
    [false, undefined, { optional: false, allowedChars: "abcd", len: 3 }],
    [false, undefined, { allowedChars: "abcd", len: 3 }],

    [true, snowmanString, { len: 3 }], // length is utf-8 bytes, not regular string length (number of codepoints)
    [true, snowmanString, { minLen: 3, maxLen: 3 }],

    [true, "abc", undefined], // no opts
    [false, 123, undefined], // no opts
  ];
  for (let [expectedValid, str, opts, note] of vectors) {
    note = note ? `   (${note})` : "";
    let msg = `${J(str)} matches ${J(opts)} ? ${expectedValid} ${note}`;
    let result = checkString(opts)(str);
    if (expectedValid === true) {
      assertEquals(result, null, msg);
    } else {
      assert(typeof result === "string", msg);
    }
  }
});

Deno.test("checkInt", () => {
  type Vector = [
    result: boolean,
    int: any,
    opts: CheckIntOpts | undefined,
    note?: string,
  ];
  let vectors: Vector[] = [
    [false, "a", {}],
    [false, null, {}],
    [false, undefined, {}],
    [false, true, {}],
    [false, false, {}],
    [false, ["a"], {}],
    [false, { a: 1 }, {}],
    [false, new Set(), {}],
    [false, new Map(), {}],
    [false, new TestClass(), {}],

    [true, 123, {}],

    [true, 123, { optional: false, min: 1 }],
    [true, 123, { optional: true, min: 1 }],
    [false, undefined, { optional: false, min: 1 }],
    [true, undefined, { optional: true, min: 1 }],
    [false, undefined, { min: 1 }],
    [false, null, { optional: false, min: 1 }],
    [false, null, { optional: true, min: 1 }],
    [false, null, { min: 1 }],

    [true, 123, { nullable: false, min: 1 }],
    [true, 123, { nullable: true, min: 1 }],
    [false, undefined, { nullable: false, min: 1 }],
    [false, undefined, { nullable: true, min: 1 }],
    [false, undefined, { min: 1 }],
    [false, null, { nullable: false, min: 1 }],
    [true, null, { nullable: true, min: 1 }],
    [false, null, { min: 1 }],

    [true, null, { optional: true, nullable: true }],
    [true, null, { optional: false, nullable: true }],
    [false, null, { optional: true, nullable: false }],
    [false, null, { optional: false, nullable: false }],
    [true, undefined, { optional: true, nullable: true }],
    [false, undefined, { optional: false, nullable: true }],
    [true, undefined, { optional: true, nullable: false }],
    [false, undefined, { optional: false, nullable: false }],

    [false, 122, { min: 123 }],
    [true, 123, { min: 123 }],
    [true, 124, { min: 123 }],

    [true, 122, { max: 123 }],
    [true, 123, { max: 123 }],
    [false, 124, { max: 123 }],

    [true, 123, { min: 123, max: 123 }],
    [false, 123, { min: 200, max: 100 }],
    [true, 123, { min: 122, max: 124 }],

    [false, NaN, {}],
    [false, -NaN, {}],
    [false, Infinity, {}],
    [false, -Infinity, {}],

    [false, 1.2345, {}, "not an integer"],

    // TODO: it's allowed to be larger than max_safe_integer -- is this a good idea?
    [
      true,
      Number.MAX_SAFE_INTEGER + 1,
      {},
      "larger than MAX_SAFE_INTEGER is ok",
    ],

    [true, 123, undefined], // no opts
    [false, "abc", undefined], // no opts
  ];
  for (let [expectedValid, int, opts, note] of vectors) {
    note = note ? `   (${note})` : "";
    let msg = `${J(int)} matches ${J(opts)} ? ${expectedValid} ${note}`;
    let result = checkInt(opts)(int);
    if (expectedValid === true) {
      assertEquals(result, null, msg);
    } else {
      assert(typeof result === "string", msg);
    }
  }
});

// TODO: add tests for checkObj
