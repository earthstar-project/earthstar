import { ensureDir } from "https://deno.land/std@0.188.0/fs/ensure_dir.ts";
import { join } from "https://deno.land/std@0.188.0/path/win32.ts";
import { Willow } from "../../deps.ts";
import { IdentityAddress, ShareAddress } from "../crypto/types.ts";
import {
  fingerprintScheme,
  namespaceScheme,
  pathScheme,
  payloadScheme,
  subspaceScheme,
} from "../parameters/schemes.ts";
import {
  KvDriverDeno,
  PayloadDriverFilesystem,
} from "../../../willow-js/mod.deno.ts";

export async function filesystemDrivers(path: string): Promise<{
  entryDriver: Willow.EntryDriver<
    ShareAddress,
    IdentityAddress,
    ArrayBuffer,
    ArrayBuffer
  >;
  payloadDriver: Willow.PayloadDriver<ArrayBuffer>;
}> {
  const kvPath = join(path, "entries");
  const payloadPath = join(path, "payloads");

  await ensureDir(path);

  // TODO: Use the platform appropriate KV driver.
  const kv = await Deno.openKv(kvPath);

  const payloadDriver = new PayloadDriverFilesystem(
    payloadPath,
    payloadScheme,
  );

  return {
    entryDriver: new Willow.EntryDriverKvStore({
      kvDriver: new KvDriverDeno(kv),
      fingerprintScheme,
      namespaceScheme,
      pathScheme,
      payloadScheme,
      subspaceScheme,
      getPayloadLength: (digest) => {
        return payloadDriver.length(digest);
      },
    }),
    payloadDriver,
  };
}
