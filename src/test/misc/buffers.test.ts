import { Buffer } from "https://deno.land/std@0.122.0/node/buffer.ts";
import { assert, assertEquals } from "../asserts.ts";
import { snowmanBytes, snowmanString } from "../test-utils.ts";
//t.runOnly = true;

let TEST_NAME = "buffers";

// Boilerplate to help browser-run know when this test is completed.
// When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function.
/* istanbul ignore next */

import {
  bufferToBytes,
  bufferToString,
  bytesToBuffer,
  stringToBuffer,
} from "../../util/buffers.ts";

import { identifyBufOrBytes, isBuffer, isBytes } from "../../util/bytes.ts";

//================================================================================

let snowmanBuffer = Buffer.from([0xe2, 0x98, 0x83]);

let simpleString = "aa";
let simpleBuffer = Buffer.from([97, 97]);

//================================================================================

Deno.test("bytesToBuffer", () => {
  assertEquals(
    bytesToBuffer(snowmanBytes),
    snowmanBuffer,
    "snowman bytes to buffer",
  );
  assertEquals(
    identifyBufOrBytes(bytesToBuffer(snowmanBytes)),
    "buffer",
    "returns buffer",
  );
});

Deno.test("bufferToBytes", () => {
  assertEquals(
    bufferToBytes(snowmanBuffer),
    snowmanBytes,
    "snowman buffer to bytes",
  );
  assertEquals(
    identifyBufOrBytes(bufferToBytes(snowmanBuffer)),
    "bytes",
    "returns bytes",
  );
});

//--------------------------------------------------

Deno.test("bufferToString", () => {
  assertEquals(
    bufferToString(simpleBuffer),
    simpleString,
    "simple buffer to string",
  );
  assertEquals(
    bufferToString(snowmanBuffer),
    snowmanString,
    "snowman buffer to string",
  );
  assert(
    typeof bufferToString(snowmanBuffer) === "string",
    "returns a string",
  );
});

Deno.test("stringToBuffer", () => {
  assertEquals(
    stringToBuffer(simpleString),
    simpleBuffer,
    "simple string to buffer",
  );
  assertEquals(
    stringToBuffer(snowmanString),
    snowmanBuffer,
    "snowman string to buffer",
  );
  assertEquals(
    identifyBufOrBytes(stringToBuffer(snowmanString)),
    "buffer",
    "returns buffer",
  );
});

Deno.test("buffer: identifyBufOrBytes, isBuffer, isBytes", () => {
  let buf = Buffer.from([1]);
  let bytes = Uint8Array.from([1]);
  let other = [1, 2, 3];

  assertEquals(identifyBufOrBytes(buf), "buffer", "can identify Buffer");
  assertEquals(isBuffer(buf), true, "isBuffer true");
  assertEquals(isBytes(buf), false, "isBytes false");

  assertEquals(identifyBufOrBytes(bytes), "bytes", "can identify bytes");
  assertEquals(isBuffer(bytes), false, "isBuffer false");
  assertEquals(isBytes(bytes), true, "isBytes true");

  assertEquals(
    identifyBufOrBytes(other as any),
    "?",
    "is not tricked by other kinds of object",
  );
  assertEquals(isBuffer(other), false, "isBuffer false on other");
  assertEquals(isBytes(other), false, "isBytes false on other");
});
