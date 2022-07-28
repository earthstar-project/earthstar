import { DocBlob } from "../../util/doc-types.ts";
import { ValidationError } from "../../util/errors.ts";
import { IReplicaBlobDriver } from "../replica-types.ts";
import { join } from "https://deno.land/std@0.132.0/path/mod.ts";

export class BlobDriverFilesystem implements IReplicaBlobDriver {
  private path: string;

  constructor(path: string) {
    this.path = path;
  }

  async upsert(
    formatName: string,
    attachmentHash: string,
    blob: ReadableStream<Uint8Array> | Uint8Array,
  ) {
    // Create the path
    try {
      await Deno.lstat(this.path);
    } catch {
      await Deno.mkdir(this.path);
    }

    const filePath = join(this.path, formatName, attachmentHash);

    if (blob instanceof Uint8Array) {
      await Deno.writeFile(filePath, blob, { create: true });
    } else {
      try {
        await Deno.truncate(filePath);
      } catch {
        // It's fine.
      }

      await blob.pipeTo(
        new WritableStream({
          async write(chunk) {
            await Deno.writeFile(filePath, chunk, {
              create: true,
              append: true,
            });
          },
        }),
      );
    }

    return true as const;
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
      if (entry.isFile) {
        const path = join(this.path, entry.name);
        await Deno.remove(path);
      }
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
}
