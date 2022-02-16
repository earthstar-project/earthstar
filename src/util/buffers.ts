import { Buffer } from "https://deno.land/std@0.122.0/node/buffer.ts";

/**
 * This file provides common operations on Buffer.
 * Any util function that uses a Buffer should be here, not in bytes.ts.
 */
//--------------------------------------------------

import { isBuffer, isBytes } from "./bytes.ts";

export function bytesToBuffer(bytes: Uint8Array): Buffer {
    return Buffer.from(bytes);
}

export function bufferToBytes(buf: Buffer): Uint8Array {
    return new Uint8Array(
        buf.buffer,
        buf.byteOffset,
        buf.byteLength / Uint8Array.BYTES_PER_ELEMENT,
    );
}

//--------------------------------------------------

export function stringToBuffer(str: string): Buffer {
    return Buffer.from(str, "utf-8");
}

export function bufferToString(buf: Buffer): string {
    return buf.toString("utf-8");
}

export function identifyBufOrBytes(bufOrBytes: Buffer | Uint8Array): string {
    if (isBytes(bufOrBytes)) return "bytes";
    if (isBuffer(bufOrBytes)) return "buffer";
    return "?";
}
