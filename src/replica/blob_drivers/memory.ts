import { FormatArg } from "../../formats/default.ts";
import { DocBlob } from "../../util/doc-types.ts";
import { ValidationError } from "../../util/errors.ts";
import { streamToBytes } from "../../util/streams.ts";
import { IReplicaBlobDriver } from "../replica-types.ts";

export class BlobDriverMemory implements IReplicaBlobDriver {
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

  async upsert(
    formatName: string,
    expectedHash: string,
    blob: ReadableStream<Uint8Array> | Uint8Array,
  ) {
    const key = this.getKey(formatName, expectedHash);

    if (blob instanceof Uint8Array) {
      const newBlob = new Blob([blob]);

      this.blobMap.set(key, newBlob);
    } else {
      const bytes = await streamToBytes(blob);

      const newBlob = new Blob([bytes]);

      this.blobMap.set(key, newBlob);
    }

    return Promise.resolve(true as const);
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
}
