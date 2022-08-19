import { DocAttachment } from "../../util/doc-types.ts";
import {
  isErr,
  ReplicaIsClosedError,
  ValidationError,
} from "../../util/errors.ts";
import { IReplicaAttachmentDriver } from "../replica-types.ts";
import { randomId } from "../../util/misc.ts";
import { Crypto } from "../../crypto/crypto.ts";
import { AttachmentStreamInfo } from "../../util/attachment_stream_info.ts";
import { walk } from "https://esm.sh/@nodelib/fs.walk@1.2.8";
import * as fs from "https://deno.land/std@0.152.0/node/fs/promises.ts";
import * as path from "https://deno.land/std@0.152.0/node/path.ts";
import { bufferToBytes } from "../../util/buffers.ts";
import { deferred } from "https://deno.land/std@0.138.0/async/deferred.ts";

/** An attachment driver which persists attachments using the local filesystem.
 * Works with Deno and Node.
 */
export class AttachmentDriverFilesystem implements IReplicaAttachmentDriver {
  private path: string;
  private closed = false;

  /** @param path - The filesystem path all attachments will be stored under. */
  constructor(path: string) {
    this.path = path;
  }

  private async ensurePath(...args: string[]) {
    try {
      await fs.lstat(path.join(this.path, ...args));
    } catch {
      await fs.mkdir(path.join(this.path, ...args), {
        recursive: true,
      });
    }
  }

  async stage(
    formatName: string,
    attachment: ReadableStream<Uint8Array> | Uint8Array,
  ) {
    if (this.closed) throw new ReplicaIsClosedError();
    // Create the path
    await this.ensurePath("staging", formatName);

    const tempKey = randomId();

    const stagingPath = path.join(this.path, "staging", formatName, tempKey);

    if (attachment instanceof Uint8Array) {
      await fs.writeFile(stagingPath, attachment);
      const hash = await Crypto.sha256base32(attachment);

      return {
        hash,
        size: attachment.byteLength,
        commit: async () => {
          try {
            await fs.lstat(path.join(this.path, formatName));
          } catch {
            await fs.mkdir(path.join(this.path, formatName));
          }

          return fs.rename(stagingPath, path.join(this.path, formatName, hash));
        },
        reject: () => {
          return fs.rm(stagingPath);
        },
      };
    }

    const attachmentStreamInfo = new AttachmentStreamInfo();

    try {
      await fs.truncate(stagingPath);
    } catch {
      // It's fine.
    }

    const file = await fs.open(stagingPath, "w");
    const writeStream = file.createWriteStream({ start: 0 });

    await attachment.pipeThrough(attachmentStreamInfo).pipeTo(
      new WritableStream({
        async write(chunk) {
          await new Promise((res) => {
            writeStream.write(chunk, "binary", res);
          });
        },
        close() {
          writeStream.end();
        },
      }),
    );

    const hash = await attachmentStreamInfo.hash;
    const size = await attachmentStreamInfo.size;

    return {
      hash,
      size,
      commit: () => {
        return fs.rename(stagingPath, path.join(this.path, formatName, hash));
      },
      reject: () => {
        return fs.rm(stagingPath);
      },
    };
  }

  async erase(formatName: string, attachmentHash: string) {
    if (this.closed) throw new ReplicaIsClosedError();
    const filePath = path.join(this.path, formatName, attachmentHash);

    try {
      await fs.rm(filePath);
      return true;
    } catch {
      return new ValidationError(`Attachment not found`);
    }
  }

  async wipe() {
    if (this.closed) throw new ReplicaIsClosedError();
    await this.clearStaging();

    try {
      const entries = await fs.readdir(this.path);
      for (const entry of entries) {
        await fs.rm(path.join(this.path, entry), { recursive: true });
      }
    } catch {
      // Do nothing...
      return Promise.resolve();
    }
  }

  async getAttachment(
    formatName: string,
    attachmentHash: string,
  ): Promise<DocAttachment | undefined> {
    if (this.closed) throw new ReplicaIsClosedError();
    const filePath = path.join(this.path, formatName, attachmentHash);

    try {
      await fs.lstat(filePath);
    } catch {
      return undefined;
    }

    return {
      bytes: async () => bufferToBytes(await fs.readFile(filePath)),
      stream: () => {
        const readableStream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const file = await fs.open(filePath, "r");
            const readStream = file.createReadStream();

            readStream.on("end", () => {
              controller.close();
            });

            readStream.on("data", (chunk: Buffer) => {
              controller.enqueue(bufferToBytes(chunk));
            });
          },
        });

        return Promise.resolve(readableStream);
      },
    };
  }

  async clearStaging() {
    if (this.closed) throw new ReplicaIsClosedError();
    try {
      await fs.rm(path.join(this.path, "staging"), { recursive: true });
    } catch {
      return Promise.resolve();
    }
  }

  async filter(
    attachments: Record<string, Set<string>>,
  ): Promise<{ format: string; hash: string }[]> {
    if (this.closed) throw new ReplicaIsClosedError();
    try {
      await fs.lstat(this.path);
    } catch {
      return [];
    }

    const erased: { format: string; hash: string }[] = [];

    const walkDeferred = deferred();

    walk(this.path, async (_error, entries) => {
      for (const entry of entries) {
        if (entry.dirent.isFile()) {
          const format = path.dirname(path.relative(this.path, entry.path));
          const hash = path.basename(entry.path);

          if (format !== "staging") {
            const allowedHashes = attachments[format];

            if (allowedHashes && !allowedHashes.has(hash)) {
              const res = await this.erase(format, hash);

              if (!isErr(res)) {
                erased.push({ format, hash });
              }
            }
          }
        }
      }

      walkDeferred.resolve();
    });

    await walkDeferred;

    return erased;
  }

  isClosed(): boolean {
    return this.closed;
  }

  async close(erase: boolean): Promise<void> {
    if (this.closed) throw new ReplicaIsClosedError();

    if (erase) {
      await this.wipe();
    }

    this.closed = true;

    return;
  }
}
