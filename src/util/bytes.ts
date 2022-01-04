/**
 * This file provides common operations on Uint8Arrays.
 * It should not use any Buffers to do so.
 * Any function that uses Buffer should be in buffers.ts.
 * This helps us avoid bringing in the heavy polyfill for Buffer
 * when bundling for the browser.
 */

import { rfc4648 } from "../../deps.ts";

let decoder: TextDecoder = new TextDecoder();
let encoder: TextEncoder = new TextEncoder();

//--------------------------------------------------

export let bytesToString = (bytes: Uint8Array): string => decoder.decode(bytes);

export let stringToBytes = (str: string): Uint8Array => encoder.encode(str);

//--------------------------------------------------

export let stringLengthInBytes = (str: string): number =>
  // TODO: is there a more efficient way to do this?
  // If we had a Buffer we could just do Buffer.byteLength(str, 'utf-8');
  stringToBytes(str).length;

export let concatBytes = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  // Checks for truthy values or empty arrays on each argument
  // to avoid the unnecessary construction of a new array and
  // the type comparison
  if (!b || b.length === 0) return a;
  if (!a || a.length === 0) return b;

  var c = new Uint8Array(a.length + b.length);
  c.set(a);
  c.set(b, a.length);

  return c;
};

//--------------------------------------------------

export let b64StringToBytes = (b64string: string): Uint8Array =>
  rfc4648.base64.parse(b64string);

//--------------------------------------------------

export let isBytes = (bytes: any): bytes is Uint8Array =>
  bytes?.constructor?.name === "Uint8Array";
//return bytes.writeUInt8 === undefined && bytes instanceof Uint8Array;

export let isBuffer = (buf: any): boolean =>
  // do this without any official reference to Buffer
  // to avoid bringing in the Buffer polyfill
  buf?.constructor?.name === "Buffer";
//buf instanceof Buffer;
