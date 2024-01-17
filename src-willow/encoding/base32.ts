import { stdDecodeBase32, stdEncodeBase32 } from "../../deps.ts";

export function encodeBase32(bytes: Uint8Array) {
  const raw = stdEncodeBase32(bytes);
  const expectedLength = Math.ceil(bytes.byteLength * 8 / 5);

  return "b" + raw.slice(0, expectedLength).toLowerCase();
}

export function decodeBase32(base32Str: string) {
  const withoutB = base32Str.slice(1);

  const remainder8 = withoutB.length % 8;

  if (remainder8 === 0) {
    return stdDecodeBase32(withoutB.toUpperCase());
  }

  const targetLength = withoutB.length + (8 - remainder8);
  const withPadding = withoutB.padEnd(targetLength, "=");

  return stdDecodeBase32(withPadding.toUpperCase());
}
