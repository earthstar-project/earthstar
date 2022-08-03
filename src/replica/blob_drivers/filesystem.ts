import { DocBlob } from "../../util/doc-types.ts";
import { isErr, ValidationError } from "../../util/errors.ts";
import { IReplicaBlobDriver } from "../replica-types.ts";
import {
  basename,
  dirname,
  join,
  relative,
} from "https://deno.land/std@0.132.0/path/mod.ts";
import { move } from "https://deno.land/std@0.149.0/fs/mod.ts";
import { randomId } from "../../util/misc.ts";
import { Crypto } from "../../crypto/crypto.ts";
import { AttachmentStreamInfo } from "../../util/attachment_stream_info.ts";
import { walk } from "https://deno.land/std@0.132.0/fs/mod.ts";

export class BlobDriverFilesystem implements IReplicaBlobDriver {
  private path: string;

  constructor(path: string) {
    this.path = path;
  }

  private async ensurePath(...args: string[]) {
    try {
      await Deno.lstat(join(this.path, ...args));
    } catch {
      await Deno.mkdir(join(this.path, ...args), {
        recursive: true,
      });
    }
  }

  async stage(
    formatName: string,
    blob: ReadableStream<Uint8Array> | Uint8Array,
  ) {
    // Create the path
    await this.ensurePath("staging", formatName);

    const tempKey = randomId();

    const stagingPath = join(this.path, "staging", formatName, tempKey);

    if (blob instanceof Uint8Array) {
      await Deno.writeFile(stagingPath, blob, { create: true });
      const hash = await Crypto.sha256base32(blob);

      return {
        hash,
        size: blob.byteLength,
        commit: async () => {
          try {
            await Deno.lstat(join(this.path, formatName));
          } catch {
            await Deno.mkdir(join(this.path, formatName));
          }

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

    await blob.pipeThrough(attachmentStreamInfo).pipeTo(
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
      commit: () => {
        return move(stagingPath, join(this.path, formatName, hash), {
          overwrite: true,
        });
      },
      reject: () => {
        return Deno.remove(stagingPath);
      },
    };
  }

  async erase(formatName: string, attachmentHash: string) {
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

  async getBlob(
    formatName: string,
    attachmentHash: string,
  ): Promise<DocBlob | undefined> {
    const filePath = join(this.path, formatName, attachmentHash);

    try {
      await Deno.lstat(filePath);
    } catch {
      return undefined;
    }

    const file = await Deno.open(filePath, { read: true });

    return {
      bytes: () => Deno.readFile(filePath),
      stream: file.readable,
    };
  }

  async clearStaging() {
    try {
      await Deno.remove(join(this.path, "staging"), { recursive: true });
    } catch {
      return Promise.resolve();
    }
  }

  async filter(
    attachments: Record<string, Set<string>>,
  ): Promise<{ format: string; hash: string }[]> {
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
}
