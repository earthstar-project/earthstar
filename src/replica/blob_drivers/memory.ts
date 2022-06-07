import { DocBlob } from "../../util/doc-types.ts";
import { ValidationError } from "../../util/errors.ts";
import { streamToBytes } from "../../util/streams.ts";
import { IReplicaBlobDriver } from "../replica-types.ts";

export class BlobDriverMemory implements IReplicaBlobDriver {
  private blobMap = new Map<string, Blob>();

  async getBytes(signature: string) {
    const blob = this.blobMap.get(signature);

    if (blob) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return bytes;
    }
  }

  getStream(signature: string) {
    const blob = this.blobMap.get(signature);

    if (blob) {
      return Promise.resolve(blob.stream());
    }

    return Promise.resolve(undefined);
  }

  getBlob(signature: string): Promise<DocBlob | undefined> {
    const blob = this.blobMap.get(signature);

    if (!blob) {
      return Promise.resolve(undefined);
    }

    return Promise.resolve({
      bytes: async () => new Uint8Array(await blob.arrayBuffer()),
      stream: blob.stream(),
    });
  }

  async upsert(
    signature: string,
    blob: ReadableStream<Uint8Array> | Uint8Array,
  ) {
    if (blob instanceof Uint8Array) {
      const newBlob = new Blob([blob]);

      this.blobMap.set(signature, newBlob);
    } else {
      const bytes = await streamToBytes(blob);

      const newBlob = new Blob([bytes]);
      this.blobMap.set(signature, newBlob);

      this.blobMap.set(signature, newBlob);
    }

    return Promise.resolve(true as const);
  }

  erase(signature: string) {
    if (this.blobMap.has(signature)) {
      this.blobMap.delete(signature);
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
