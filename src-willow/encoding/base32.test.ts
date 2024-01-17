import { assertEquals } from "$std/testing/asserts.ts";
import { decodeBase32, encodeBase32 } from "./base32.ts";

Deno.test("Base32 encoding and decoding", () => {
  for (let i = 0; i < 100; i++) {
    const length = Math.floor(Math.random() * 100);

    const bytes = crypto.getRandomValues(new Uint8Array(length));

    const encoded = encodeBase32(bytes);
    const decoded = decodeBase32(encoded);

    assertEquals(decoded, bytes);
  }
});
