/** A driver capable of creating {@linkcode Blake3Digest} from bytes. */
export type Blake3Driver = (
  source: Uint8Array | AsyncIterable<Uint8Array>,
) => Promise<Blake3Digest>;

/** A BLAKE3 digest created by a {@linkcode Blake3Driver}. */
export type Blake3Digest = Uint8Array;
