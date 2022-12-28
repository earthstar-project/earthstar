import { deferred } from "../../deps.ts";
import { base32BytesToString } from "../crypto/base32.ts";
import { Crypto } from "../crypto/crypto.ts";

export class AttachmentStreamInfo {
  private transformer: TransformStream<Uint8Array, Uint8Array>;
  private updatableHash = Crypto.updatableSha256();

  size = deferred<number>();
  hash = deferred<string>();

  constructor() {
    const { updatableHash, size, hash } = this;

    let currentSize = 0;

    this.transformer = new TransformStream({
      transform(chunk, controller) {
        updatableHash.update(chunk);
        currentSize += chunk.byteLength;

        controller.enqueue(chunk);
      },
      flush() {
        const digest = updatableHash.digest();

        hash.resolve(base32BytesToString(digest));
        size.resolve(currentSize);
      },
    });
  }

  get writable() {
    return this.transformer.writable;
  }

  get readable() {
    return this.transformer.readable;
  }
}
