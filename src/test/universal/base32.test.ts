import { assert, assertEquals, assertThrows } from "../asserts.ts";

let TEST_NAME = "base32";

import {
  base32BytesToString,
  base32StringToBytes,
} from "../../crypto/base32.ts";
import { ValidationError } from "../../util/errors.ts";

//================================================================================

Deno.test("base32 encoding", () => {
  let bytes = Uint8Array.from([1, 2, 3, 4, 5]);
  let str = base32BytesToString(bytes);
  let bytes2 = base32StringToBytes(str);
  let str2 = base32BytesToString(bytes2);

  assert(bytes2 instanceof Uint8Array, "decoding creates a Uint8Array");

  assertEquals(bytes, bytes2, "bytes roundtrip to base32");
  assertEquals(str, str2, "base32 roundtrip to bytes");
  assert(str.startsWith("b"), "base32 startswith b");

  assertEquals(
    base32BytesToString(Uint8Array.from([])),
    "b",
    'base32 can encode Uint8Array([]) to "b"',
  );
  assertEquals(
    base32BytesToString(Uint8Array.from([0])),
    "baa",
    'base32 can encode Uint8Array([0]) to "baa"',
  );

  assertEquals(
    base32StringToBytes("b"),
    Uint8Array.from([]),
    'base32 can decode just the string "b" to an empty Uint8Array',
  );
  assertEquals(
    base32StringToBytes("baa"),
    Uint8Array.from([0]),
    'base32 can decode the string "baa" to Uint8Array([0])',
  );

  assertThrows(
    () => base32StringToBytes(""),
    ValidationError,
    undefined,
    "decoding base32 throws an exception if string is empty",
  );
  assertThrows(
    () => base32StringToBytes("abc"),
    ValidationError,
    undefined,
    'decoding base32 throws an exception when it does not start with "b"',
  );
  assertThrows(
    () => base32StringToBytes("b123"),
    SyntaxError,
    undefined,
    "decoding base32 throws when encountering invalid base32 character",
  );
  assertThrows(
    () => base32StringToBytes("babc?xyz"),
    SyntaxError,
    undefined,
    "decoding base32 throws when encountering invalid base32 character",
  );
  assertThrows(
    () => base32StringToBytes("babc xyz"),
    SyntaxError,
    undefined,
    "decoding base32 throws when encountering invalid base32 character",
  );
  assertThrows(
    () => base32StringToBytes("b abcxyz"),
    SyntaxError,
    undefined,
    "decoding base32 throws when encountering invalid base32 character",
  );
  assertThrows(
    () => base32StringToBytes("babcxyz "),
    SyntaxError,
    undefined,
    "decoding base32 throws when encountering invalid base32 character",
  );
  assertThrows(
    () => base32StringToBytes("babcxyz\n"),
    SyntaxError,
    undefined,
    "decoding base32 throws when encountering invalid base32 character",
  );
  assertThrows(
    () => base32StringToBytes("BABC"),
    ValidationError,
    undefined,
    "decoding base32 throws when encountering a different multibase encoding",
  );
  assertThrows(
    () => base32StringToBytes("b???"),
    SyntaxError,
    undefined,
    'decoding base32 throws on "b???"',
  );
  assertThrows(
    () => base32StringToBytes("b11"),
    SyntaxError,
    undefined,
    'decoding base32 throws on "b11"',
  );

  // make sure we have a multibase version that fixed this bug:
  // https://github.com/multiformats/js-multibase/issues/17
  let exampleBytes = base32StringToBytes(
    "bciqbed3k6ya5i3qqwljochwxdrk5exzqilbckapedujenz5b5hj5r3a",
  );
  let exampleString =
    "bciqbed3k6ya5i3qqwljochwxdrk5exzqilbckapedujenz5b5hj5r3a";
  assertEquals(
    base32BytesToString(exampleBytes),
    exampleString,
    "edge case works",
  );

  let bytes_11 = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  let str_11_correct = "baebagbafaydqqcikbm";
  let str_11_loose1 = "baebagbafaydqqc1kbm"; // i to 1
  let str_11_loose2 = "baebagbafaydqqcikbM"; // uppercase M at end
  assertEquals(
    base32BytesToString(bytes_11),
    str_11_correct,
    "encodes bytes to correct string",
  );
  assertEquals(
    base32StringToBytes(str_11_correct),
    bytes_11,
    "decodes string to correct bytes",
  );
  assertThrows(
    () => base32StringToBytes(str_11_loose1),
    SyntaxError,
    undefined,
    "throws on loose string (i vs 1)",
  );
  assertThrows(
    () => base32StringToBytes(str_11_loose2),
    SyntaxError,
    undefined,
    "throws on loose string (case change)",
  );

  let padded_b32 = "baa======";
  let unpadded_b32 = "baa";
  let matching_buf = Uint8Array.from([0]);

  assertEquals(
    base32StringToBytes(unpadded_b32),
    matching_buf,
    "unpadded base32 is handled ok",
  );
  assertThrows(
    () => base32StringToBytes(padded_b32),
    ValidationError,
    undefined,
    "padded base32 is not allowed",
  );
});
