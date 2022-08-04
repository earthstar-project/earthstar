import { Crypto } from "../../crypto/crypto.ts";
import { DocAttachment } from "../../util/doc-types.ts";
import { ValidationError } from "../../util/errors.ts";
import { streamToBytes } from "../../util/streams.ts";
import { IReplicaAttachmentDriver } from "../replica-types.ts";

/** An attachment driver which persists attachments in memory.
 * Works everywhere.
 */
export class AttachmentDriverMemory implements IReplicaAttachmentDriver {
  private stagingMap = new Map<string, Blob>();
  private attachmentMap = new Map<string, Blob>();

  private getKey(formatName: string, attachmentHash: string) {
    return `${formatName}___${attachmentHash}`;
  }

  getAttachment(
    formatName: string,
    attachmentHash: string,
  ): Promise<DocAttachment | undefined> {
    const key = this.getKey(formatName, attachmentHash);
    const attachment = this.attachmentMap.get(key);

    if (!attachment) {
      return Promise.resolve(undefined);
    }

    return Promise.resolve({
      bytes: async () => new Uint8Array(await attachment.arrayBuffer()),
      stream: () => Promise.resolve(attachment.stream()),
    });
  }

  async stage(
    formatName: string,
    attachment: ReadableStream<Uint8Array> | Uint8Array,
  ) {
    const bytes = attachment instanceof Uint8Array
      ? attachment
      : await streamToBytes(attachment);

    const hash = await Crypto.sha256base32(bytes);

    const newAttachment = new Blob([bytes]);

    const key = this.getKey(formatName, hash);

    this.stagingMap.set(key, newAttachment);

    return Promise.resolve({
      hash,
      size: bytes.byteLength,
      commit: () => {
        this.attachmentMap.set(key, newAttachment);
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
    if (this.attachmentMap.has(key)) {
      this.attachmentMap.delete(key);
      return Promise.resolve(true as true);
    }

    return Promise.resolve(
      new ValidationError("No attachment with that signature found."),
    );
  }

  wipe() {
    this.attachmentMap.clear();
    return Promise.resolve();
  }

  async filter(
    hashes: Record<string, Set<string>>,
  ): Promise<{ format: string; hash: string }[]> {
    const erasedAttachments = [];

    for (const key of this.attachmentMap.keys()) {
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
