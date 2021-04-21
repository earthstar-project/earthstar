import { TextDecoder, TextEncoder } from 'util';

let decoder = new TextDecoder();
let encoder = new TextEncoder();

//--------------------------------------------------

export let bytesToString = (bytes: Uint8Array): string =>
    decoder.decode(bytes);

export let stringToBytes = (str: string): Uint8Array =>
    encoder.encode(str);

//--------------------------------------------------

export let bytesToBuffer = (bytes: Uint8Array): Buffer =>
    Buffer.from(bytes);

export let bufferToBytes = (buf: Buffer): Uint8Array =>
    new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength / Uint8Array.BYTES_PER_ELEMENT);

//--------------------------------------------------

export let stringToBuffer = (str: string): Buffer =>
    Buffer.from(str, 'utf-8');

export let bufferToString = (buf: Buffer): string =>
    buf.toString('utf-8');

//--------------------------------------------------

export let stringLengthInBytes = (str: string): number =>
    // TODO: is there a more efficient way to do this?
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
    bufferToBytes(Buffer.from(b64string, 'base64'));

export let hexStringToBytes = (hexString: string): Uint8Array =>
    bufferToBytes(Buffer.from(hexString, 'hex'));

//--------------------------------------------------

export let isBuffer = (buf: any): boolean =>
    buf instanceof Buffer;

export let isBytes = (bytes: any): boolean => {
    return bytes.writeUInt8 === undefined && bytes instanceof Uint8Array;
}

export let identifyBufOrBytes = (bufOrBytes: Buffer | Uint8Array): string => {
    if (isBytes(bufOrBytes)) { return 'bytes'; }
    return 'buffer';
}

