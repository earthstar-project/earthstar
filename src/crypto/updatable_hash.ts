type UpdatableHashOpts<HashType> = {
  hash: HashType;
  update: (hash: HashType, data: Uint8Array) => HashType;
  digest: (hash: HashType) => Uint8Array;
};

export class UpdatableHash<HashType> {
  private hash: HashType;
  private internalUpdate: UpdatableHashOpts<HashType>["update"];
  private internalDigest: UpdatableHashOpts<HashType>["digest"];

  constructor(opts: UpdatableHashOpts<HashType>) {
    this.hash = opts.hash;
    this.internalUpdate = opts.update;
    this.internalDigest = opts.digest;
  }

  update(data: Uint8Array): HashType {
    this.hash = this.internalUpdate(this.hash, data);

    return this.hash;
  }

  /** Returns the digest of the hash. **The result is not encoded to base32**. */
  digest(): Uint8Array {
    return this.internalDigest(this.hash);
  }
}
