export type Blake3Driver = (
  source: Uint8Array | AsyncIterable<Uint8Array>,
) => Promise<Uint8Array>;

export type Blake3Digest = Uint8Array;
