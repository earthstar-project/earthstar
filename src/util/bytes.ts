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

export function bytesToString(bytes: Uint8Array): string {
    return decoder.decode(bytes);
}

export function stringToBytes(str: string): Uint8Array {
    return encoder.encode(str);
}

//--------------------------------------------------

export function stringLengthInBytes(str: string): number {
    // TODO: is there a more efficient way to do this?
    // If we had a Buffer we could just do Buffer.byteLength(str, 'utf-8');
    return stringToBytes(str).length;
}

export function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
    // Checks for truthy values or empty arrays on each argument
    // to avoid the unnecessary construction of a new array and
    // the type comparison
    if (!b || b.length === 0) return a;
    if (!a || a.length === 0) return b;

    var c = new Uint8Array(a.length + b.length);
    c.set(a);
    c.set(b, a.length);

    return c;
}

//--------------------------------------------------

export function b64StringToBytes(b64string: string): Uint8Array {
    return rfc4648.base64.parse(b64string);
}

//--------------------------------------------------

export function isBytes(bytes: any): bytes is Uint8Array {
    return bytes?.constructor?.name === "Uint8Array";
    //return bytes.writeUInt8 === undefined && bytes instanceof Uint8Array;
}

export function isBuffer(buf: any): boolean {
    // do this without any official reference to Buffer
    // to avoid bringing in the Buffer polyfill
    return buf?.constructor?.name === "Buffer";
    //buf instanceof Buffer;
}

export function identifyBufOrBytes(bufOrBytes: any | Uint8Array): string {
    if (isBytes(bufOrBytes)) return "bytes";
    if (isBuffer(bufOrBytes)) return "buffer";
    return "?";
}
