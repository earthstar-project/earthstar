/**
 * This file provides common operations on Uint8Arrays.
 * It should not use any Buffers to do so.
 * Any function that uses Buffer should be in buffers.ts.
 * This helps us avoid bringing in the heavy polyfill for Buffer
 * when bundling for the browser.
 */

declare let window: any;

// TODO: remove this import after fixing b64String and hexString...
import { bufferToBytes } from './buffers';

// annoying workaround to get TextDecoder from Node or in browsers...
import { TextDecoder, TextEncoder } from 'util';

let decoder: TextDecoder;
let encoder: TextEncoder;
/* istanbul ignore next */ 
if (TextDecoder !== undefined && TextEncoder !== undefined) {
    // in node, it's in the 'util' package
    decoder = new TextDecoder();
    encoder = new TextEncoder();
} else {
    // in browser, it's a global on window
    decoder = new window.TextDecoder();
    encoder = new window.TextEncoder();
}

//--------------------------------------------------

export let bytesToString = (bytes: Uint8Array): string =>
    decoder.decode(bytes);

export let stringToBytes = (str: string): Uint8Array =>
    encoder.encode(str);

//--------------------------------------------------

export let stringLengthInBytes = (str: string): number =>
    // TODO: is there a more efficient way to do this?
    // If we had a Buffer we could just do Buffer.byteLength(str, 'utf-8');
    stringToBytes(str).length;

export let concatBytes = (a: Uint8Array, b: Uint8Array): Uint8Array => {
    // Checks for truthy values or empty arrays on each argument
    // to avoid the unnecessary construction of a new array and
    // the type comparison
    if(!b || b.length === 0) { return a; }
    if(!a || a.length === 0) { return b; }

    var c = new Uint8Array(a.length + b.length);
    c.set(a);
    c.set(b, a.length);

    return c;
}

//--------------------------------------------------

export let b64StringToBytes = (b64string: string): Uint8Array =>
    // TODO: find a way to do this without using Buffer
    bufferToBytes(Buffer.from(b64string, 'base64'));

export let hexStringToBytes = (hexString: string): Uint8Array =>
    // TODO: find a way to do this without using Buffer
    bufferToBytes(Buffer.from(hexString, 'hex'));

//--------------------------------------------------

export let isBytes = (bytes: any): bytes is Uint8Array  =>
    bytes?.constructor?.name === 'Uint8Array';
    //return bytes.writeUInt8 === undefined && bytes instanceof Uint8Array;

export let isBuffer = (buf: any): boolean =>
    // do this without any official reference to Buffer
    // to avoid bringing in the Buffer polyfill
    buf?.constructor?.name === 'Buffer';
    //buf instanceof Buffer;

export let identifyBufOrBytes = (bufOrBytes: Buffer | Uint8Array): string => {
    if (isBytes(bufOrBytes)) { return 'bytes'; }
    if (isBuffer(bufOrBytes)) { return 'buffer'; }
    return '?';
}

