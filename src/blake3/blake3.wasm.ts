import { createBLAKE3 } from "npm:hash-wasm";

const reusableBlake3 = createBLAKE3();

export async function blake3(
  source: Uint8Array | AsyncIterable<Uint8Array>,
): Promise<Uint8Array> {
  if (source instanceof Uint8Array) {
    const blake3 = await reusableBlake3;

    blake3.init();
    blake3.update(source);
    return blake3.digest("binary");
  }

  const blake3 = await createBLAKE3();

  for await (const chunk of source) {
    blake3.update(chunk);
  }

  return blake3.digest("binary");
}
