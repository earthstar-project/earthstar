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
    signature: string,
    blob: ReadableStream<Uint8Array> | Uint8Array,
  ) {
    // Create the path
    try {
      await Deno.lstat(this.path);
    } catch {
      await Deno.mkdir(this.path);
    }

    const path = join(this.path, signature);

    if (blob instanceof Uint8Array) {
      await Deno.writeFile(path, blob, { create: true });
    } else {
      try {
        await Deno.truncate(path);
      } catch {
        // It's fine.
      }

      await blob.pipeTo(
        new WritableStream({
          async write(chunk) {
            await Deno.writeFile(path, chunk, { create: true, append: true });
          },
        }),
      );
    }

    return true as const;
  }

  async erase(signature: string) {
    const path = join(this.path, signature);

    try {
      await Deno.remove(path);
      return true;
    } catch {
      return new ValidationError(`Blob for ${signature} did not exist.`);
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

  async getBlob(signature: string): Promise<DocBlob | undefined> {
    const path = join(this.path, signature);

    try {
      await Deno.lstat(path);
    } catch {
      return undefined;
    }

    const file = await Deno.open(path, { read: true });

    return {
      bytes: () => Deno.readFile(path),
      stream: file.readable,
    };
  }
}
