import { DocBlob } from "../../util/doc-types.ts";
import { ValidationError } from "../../util/errors.ts";
import { IReplicaBlobDriver } from "../replica-types.ts";
import { join } from "https://deno.land/std@0.132.0/path/mod.ts";
import { move } from "https://deno.land/std@0.149.0/fs/mod.ts";
import { randomId } from "../../util/misc.ts";
import { Crypto } from "../../crypto/crypto.ts";
import { AttachmentStreamInfo } from "../../util/attachment_stream_info.ts";

export class BlobDriverFilesystem implements IReplicaBlobDriver {
  private path: string;

  constructor(path: string) {
    this.path = path;
  }

  async stage(
    formatName: string,
    blob: ReadableStream<Uint8Array> | Uint8Array,
  ) {
    // Create the path
    try {
      await Deno.lstat(join(this.path, "staging", formatName));
    } catch {
      await Deno.mkdir(join(this.path, "staging", formatName), {
        recursive: true,
      });
    }

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
        return move(stagingPath, join(this.path, formatName, hash));
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
    for await (const entry of Deno.readDir(this.path)) {
      const path = join(this.path, entry.name);
      await Deno.remove(path, { recursive: true });
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

  clearStaging() {
    return Deno.remove(join(this.path, "staging"), { recursive: true });
  }
}
