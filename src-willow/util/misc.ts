import { encodeBase32 } from "../encoding/base32.ts";

export function randomId() {
  const randomBytes = crypto.getRandomValues(new Uint8Array(8));
  return encodeBase32(randomBytes);
}
