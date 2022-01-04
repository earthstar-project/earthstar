import { assert, assertEquals } from "../asserts.ts";
import { snowmanBytes, snowmanString } from "../test-utils.ts";
//t.runOnly = true;

let TEST_NAME = "bytes";

import {
  bytesToString,
  concatBytes,
  isBuffer,
  isBytes,
  stringLengthInBytes,
  stringToBytes,
} from "../../util/bytes.ts";

//================================================================================

let simpleString = "aa";
let simpleBytes = Uint8Array.from([97, 97]);

Deno.test("bytesToString", () => {
  assertEquals(
    bytesToString(simpleBytes),
    simpleString,
    "simple bytes to string",
  );
  assertEquals(
    bytesToString(snowmanBytes),
    snowmanString,
    "snowman bytes to string",
  );
  assert(typeof bytesToString(snowmanBytes) === "string", "returns a string");
});

Deno.test("stringToBytes", () => {
  assertEquals(
    stringToBytes(simpleString),
    simpleBytes,
    "simple string to bytes",
  );
  assertEquals(
    stringToBytes(snowmanString),
    snowmanBytes,
    "snowman string to bytes",
  );
});

//--------------------------------------------------

Deno.test("stringLengthInBytes", () => {
  assertEquals(stringLengthInBytes(simpleString), 2, "simple string");
  assertEquals(stringLengthInBytes(snowmanString), 3, "snowman string");
});

Deno.test("concatBytes", () => {
  let coldSnowmanString = "cold" + snowmanString;
  let coldSnowmanBytes = stringToBytes(coldSnowmanString);
  let concatted = concatBytes(stringToBytes("cold"), snowmanBytes);
  assertEquals(concatted, coldSnowmanBytes, "concat bytes");

  assertEquals(
    concatBytes(Uint8Array.from([]), Uint8Array.from([1, 2, 3])),
    Uint8Array.from([1, 2, 3]),
    "optimization when a is empty",
  );
  assertEquals(
    concatBytes(Uint8Array.from([1, 2, 3]), Uint8Array.from([])),
    Uint8Array.from([1, 2, 3]),
    "optimization when b is empty",
  );
});

//--------------------------------------------------

// TODO: b64stringtobytes

// TODO: hexstringtobytes

//--------------------------------------------------

Deno.test("bytes: identifyBufOrBytes, isBuffer, isBytes", () => {
  let bytes = Uint8Array.from([1]);
  let other = [1, 2, 3];

  assertEquals(isBuffer(bytes), false, "isBuffer false");
  assertEquals(isBytes(bytes), true, "isBytes true");

  assertEquals(isBuffer(other), false, "isBuffer false on other");
  assertEquals(isBytes(other), false, "isBytes false on other");
});
