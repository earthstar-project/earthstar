import { AuthorKeypair, Crypto, ShareKeypair } from "../mod.ts";

const shareAddr = await Crypto.generateShareKeypair(
  "gardening",
) as ShareKeypair;
const keypair = await Crypto.generateAuthorKeypair("suzy") as AuthorKeypair;

const path =
  "/where-are-my-socks/i/left/them/here/somewhere/has-anyone-seen-them";
const format = "es.5";

const encoder = new TextEncoder();

const shareAddressBytes = encoder.encode(shareAddr.shareAddress);
const authorBytes = encoder.encode(keypair.address);

const pathBytes = encoder.encode(path);
const formatBytes = encoder.encode(format);

// share address len can be Uint8

// author len is 59

// path len can be 512, so Uint16.

// format length can uint8

// download upload is 1 or 0

const transferDescBytes = new Uint8Array(
  59 +
    2 + shareAddressBytes.byteLength +
    1 + formatBytes.byteLength +
    2 + pathBytes.byteLength,
);

const transferView = new DataView(transferDescBytes.buffer);

let position = 0;

transferDescBytes.set(authorBytes, position);

position += authorBytes.byteLength;

transferView.setUint8(position, shareAddressBytes.byteLength);

position += 1;

transferDescBytes.set(shareAddressBytes, position);

position += shareAddressBytes.byteLength;

transferView.setUint8(position, formatBytes.byteLength);

position += 1;

transferDescBytes.set(formatBytes, position);

position += formatBytes.byteLength;

transferView.setUint16(position, pathBytes.byteLength);

position += 2;

transferDescBytes.set(pathBytes, position);

console.log(transferDescBytes.subarray(0, 4));
