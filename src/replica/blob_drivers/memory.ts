import { DocBase } from "../../util/doc-types.ts";
import { ValidationError } from "../../util/errors.ts";
import { bytesToStream, streamToBytes } from "../../util/streams.ts";
import { IReplicaBlobDriver } from "../replica-types.ts";

export class ReplicaBlobDriverMemory implements IReplicaBlobDriver {
  private bytesMap = new Map<string, Uint8Array>();

  getBytes(signature: string) {
    return Promise.resolve(this.bytesMap.get(signature));
  }

  async getStream(signature: string) {
    const bytes = await this.getBytes(signature);

    if (bytes) {
      return bytesToStream(bytes);
    }
  }

  async upsert<DocType extends DocBase<string>>(
    doc: DocType,
    blob: ReadableStream<Uint8Array>,
  ) {
    const bytes = await streamToBytes(blob);

    this.bytesMap.set(doc.signature, bytes);
  }

  erase(signature: string) {
    if (this.bytesMap.has(signature)) {
      this.bytesMap.delete(signature);
      return Promise.resolve(true as true);
    }

    return Promise.resolve(
      new ValidationError("No blob with that signature found."),
    );
  }

  wipe() {
    this.bytesMap.clear();
    return Promise.resolve();
  }
}
