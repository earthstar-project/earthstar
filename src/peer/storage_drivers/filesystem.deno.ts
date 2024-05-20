import { EntryDriverKvStore } from "@earthstar/willow";
import { KvDriverDeno, PayloadDriverFilesystem } from "@earthstar/willow/deno";
import { StorageDriver } from "../types.ts";
import {
  fingerprintScheme,
  makePayloadScheme,
  namespaceScheme,
  pathScheme,
  subspaceScheme,
} from "../../schemes/schemes.ts";
import { encodeShareTag } from "../../identifiers/share.ts";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";

export async function getStorageDriverFilesystem(
  path: string,
): Promise<StorageDriver> {
  await ensureDir(path);
  const authPath = join(path, "auth");
  const authKv = await Deno.openKv(authPath);

  return {
    auth: new KvDriverDeno(authKv),
    getStoreDrivers: async (share, runtime) => {
      const tag = encodeShareTag(share);

      const sharePath = join(path, tag);
      const payloadPath = join(sharePath, "payloads");

      const payloadScheme = makePayloadScheme(runtime.blake3);

      const payloadDriver = new PayloadDriverFilesystem(
        payloadPath,
        payloadScheme,
      );

      const entriesPath = join(sharePath, "entries");

      const entriesKv = await Deno.openKv(entriesPath);
      const entriesDriver = new KvDriverDeno(entriesKv);

      return {
        entry: new EntryDriverKvStore({
          kvDriver: entriesDriver,
          fingerprintScheme,
          namespaceScheme,
          pathScheme,
          payloadScheme,
          subspaceScheme,
          getPayloadLength: (digest) => {
            return payloadDriver.length(digest);
          },
        }),
        payload: payloadDriver,
      };
    },
  };
}
