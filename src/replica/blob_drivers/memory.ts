import { Crypto } from "../../crypto/crypto.ts";
import { DocBlob } from "../../util/doc-types.ts";
import { ValidationError } from "../../util/errors.ts";
import { streamToBytes } from "../../util/streams.ts";
import { IReplicaBlobDriver } from "../replica-types.ts";

export class BlobDriverMemory implements IReplicaBlobDriver {
  private stagingMap = new Map<string, Blob>();
  private blobMap = new Map<string, Blob>();

  private getKey(formatName: string, attachmentHash: string) {
    return `${formatName}___${attachmentHash}`;
  }

  getBlob(
    formatName: string,
    attachmentHash: string,
  ): Promise<DocBlob | undefined> {
    const key = this.getKey(formatName, attachmentHash);
    const blob = this.blobMap.get(key);

    if (!blob) {
      return Promise.resolve(undefined);
    }

    return Promise.resolve({
      bytes: async () => new Uint8Array(await blob.arrayBuffer()),
      stream: blob.stream(),
    });
  }

  async stage(
    formatName: string,
    blob: ReadableStream<Uint8Array> | Uint8Array,
  ) {
    const bytes = blob instanceof Uint8Array ? blob : await streamToBytes(blob);

    const hash = await Crypto.sha256base32(bytes);

    const newBlob = new Blob([bytes]);

    const key = this.getKey(formatName, hash);

    this.stagingMap.set(key, newBlob);

    return Promise.resolve({
      hash,
      size: bytes.byteLength,
      commit: () => {
        this.blobMap.set(key, newBlob);
        this.stagingMap.delete(key);

        return Promise.resolve();
      },
      reject: () => {
        this.stagingMap.delete(key);

        return Promise.resolve();
      },
    });
  }

  erase(formatName: string, attachmentHash: string) {
    const key = this.getKey(formatName, attachmentHash);
    if (this.blobMap.has(key)) {
      this.blobMap.delete(key);
      return Promise.resolve(true as true);
    }

    return Promise.resolve(
      new ValidationError("No blob with that signature found."),
    );
  }

  wipe() {
    this.blobMap.clear();
    return Promise.resolve();
  }

  async filter(
    hashes: Record<string, Set<string>>,
  ): Promise<{ format: string; hash: string }[]> {
    const erasedAttachments = [];

    for (const key of this.blobMap.keys()) {
      const [format, hash] = key.split("___");

      const hashesToKeep = hashes[format];

      if (hashesToKeep && !hashesToKeep.has(hash)) {
        const result = await this.erase(format, hash);

        if (result) {
          erasedAttachments.push({ format, hash });
        }
      }
    }

    return erasedAttachments;
  }

  clearStaging() {
    this.stagingMap.clear();
    return Promise.resolve();
  }
}
