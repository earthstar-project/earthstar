import { DocAttachment } from "../../util/doc-types.ts";
import {
  isErr,
  ReplicaIsClosedError,
  ValidationError,
} from "../../util/errors.ts";
import { IReplicaAttachmentDriver } from "../replica-types.ts";
import {
  basename,
  dirname,
  join,
  relative,
} from "https://deno.land/std@0.154.0/path/mod.ts";
import { move } from "https://deno.land/std@0.154.0/fs/move.ts";
import { walk } from "https://deno.land/std@0.154.0/fs/walk.ts";
import { ensureDir } from "https://deno.land/std@0.154.0/fs/ensure_dir.ts";
import { randomId } from "../../util/misc.ts";
import { Crypto } from "../../crypto/crypto.ts";
import { AttachmentStreamInfo } from "../../util/attachment_stream_info.ts";

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

  private ensureDir(...args: string[]) {
    return ensureDir(join(this.path, ...args));
  }

  async stage(
    formatName: string,
    attachment: ReadableStream<Uint8Array> | Uint8Array,
  ) {
    if (this.closed) throw new ReplicaIsClosedError();
    // Create the path

    await this.ensureDir("staging", formatName);

    const tempKey = randomId();

    const stagingPath = join(this.path, "staging", formatName, tempKey);

    if (attachment instanceof Uint8Array) {
      await Deno.writeFile(stagingPath, attachment, { create: true });
      const hash = await Crypto.sha256base32(attachment);

      return {
        hash,
        size: attachment.byteLength,
        commit: async () => {
          await this.ensureDir(formatName);

          return move(stagingPath, join(this.path, formatName, hash), {
            overwrite: true,
          });
        },
        reject: () => {
          return Deno.remove(stagingPath);
        },
      };
    }

    const attachmentStreamInfo = new AttachmentStreamInfo();

    try {
      await Deno.truncate(stagingPath);
    } catch {
      // It's fine.
    }

    await attachment.pipeThrough(attachmentStreamInfo).pipeTo(
      new WritableStream({
        async write(chunk) {
          await Deno.writeFile(stagingPath, chunk, {
            create: true,
            append: true,
          });
        },
      }),
    );

    const hash = await attachmentStreamInfo.hash;
    const size = await attachmentStreamInfo.size;

    return {
      hash,
      size,
      commit: async () => {
        await this.ensureDir(formatName);

        return move(stagingPath, join(this.path, formatName, hash), {
          overwrite: true,
        });
      },
      reject: async () => {
        try {
          // We may have gotten an empty stream, in which case no file would have been written.
          await Deno.lstat(stagingPath);
          return Deno.remove(stagingPath);
        } catch {
          return Promise.resolve();
        }
      },
    };
  }

  async erase(formatName: string, attachmentHash: string) {
    if (this.closed) throw new ReplicaIsClosedError();
    const filePath = join(this.path, formatName, attachmentHash);

    try {
      await Deno.remove(filePath);
      return true;
    } catch {
      return new ValidationError(
        `Attachment not found`,
      );
    }
  }

  async wipe() {
    if (this.closed) throw new ReplicaIsClosedError();
    await this.clearStaging();

    try {
      for await (const entry of Deno.readDir(this.path)) {
        const path = join(this.path, entry.name);

        await Deno.remove(path, { recursive: true });
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
    const filePath = join(this.path, formatName, attachmentHash);

    try {
      await Deno.lstat(filePath);
    } catch {
      return undefined;
    }

    return {
      bytes: () => Deno.readFile(filePath),
      stream: async () => {
        const file = await Deno.open(filePath);
        return file.readable;
      },
    };
  }

  async clearStaging() {
    if (this.closed) throw new ReplicaIsClosedError();
    try {
      await Deno.remove(join(this.path, "staging"), { recursive: true });
    } catch {
      return Promise.resolve();
    }
  }

  async filter(
    attachments: Record<string, Set<string>>,
  ): Promise<{ format: string; hash: string }[]> {
    if (this.closed) throw new ReplicaIsClosedError();
    try {
      await Deno.lstat(this.path);
    } catch {
      return [];
    }

    const erased = [];

    for await (const entry of walk(this.path)) {
      if (entry.isFile) {
        const format = dirname(relative(this.path, entry.path));
        const hash = basename(entry.path);

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

    return erased;
  }

  isClosed(): boolean {
    return this.closed;
  }

  async close(erase: boolean) {
    if (this.closed) throw new ReplicaIsClosedError();

    if (erase) {
      await this.wipe();
    }

    this.closed = true;

    return;
  }
}
