import { encodeBase32 } from "../encoding/base32.ts";

export function randomId() {
  const randomBytes = crypto.getRandomValues(new Uint8Array(8));
  return encodeBase32(randomBytes);
}

export function addBytes(a: Uint8Array, b: Uint8Array, length: number) {
  if (
    a.byteLength < length ||
    b.byteLength < length
  ) {
    throw new Error("i'm not doing that");
  }

  const bytes = new Uint8Array(length);

  let carried = 0;

  for (let i = 0; i < length; i++) {
    const byteA = a[a.byteLength - 1 - i];
    const byteB = b[b.byteLength - 1 - i];

    const added = carried + byteA + byteB;

    carried = added >> 8;

    bytes.set([added % 256], length - 1 - i);
  }

  return bytes;
}
