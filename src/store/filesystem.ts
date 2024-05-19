import { ensureDir } from "https://deno.land/std@0.188.0/fs/ensure_dir.ts";
import { join } from "https://deno.land/std@0.188.0/path/win32.ts";
import { Willow } from "../../deps.ts";

import {
  fingerprintScheme,
  namespaceScheme,
  pathScheme,
  payloadScheme,
  subspaceScheme,
} from "../schemes/schemes.ts";
import {
  KvDriverDeno,
  PayloadDriverFilesystem,
} from "../../../willow-js/mod.deno.ts";
import { Blake3Digest } from "../blake3/types.ts";
import { IdentityPublicKey } from "../identifiers/identity.ts";
import { SharePublicKey } from "../identifiers/share.ts";
import { PreFingerprint } from "./types.ts";

export async function filesystemDrivers(path: string): Promise<{
  entryDriver: Willow.EntryDriver<
    SharePublicKey,
    IdentityPublicKey,
    Blake3Digest,
    PreFingerprint
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
