import {
  EntryDriver,
  EntryDriverKvStore,
  KvDriver,
  KvDriverInMemory,
  PayloadDriver,
  PayloadDriverMemory,
} from "@earthstar/willow";
import { RuntimeDriver, StorageDriver } from "../types.ts";
import {
  fingerprintScheme,
  makePayloadScheme,
  namespaceScheme,
  pathScheme,
  subspaceScheme,
} from "../../schemes/schemes.ts";
import { SharePublicKey } from "../../identifiers/share.ts";
import { Blake3Digest } from "../../blake3/types.ts";
import { IdentityPublicKey } from "../../identifiers/identity.ts";
import { PreFingerprint } from "../../store/types.ts";

export class StorageDriverMemory implements StorageDriver {
  auth: KvDriver = new KvDriverInMemory();

  getStoreDrivers(_share: SharePublicKey, runtime: RuntimeDriver): Promise<{
    entry: EntryDriver<
      SharePublicKey,
      IdentityPublicKey,
      Blake3Digest,
      PreFingerprint
    >;
    payload: PayloadDriver<Blake3Digest>;
  }> {
    const payload = new PayloadDriverMemory(makePayloadScheme(runtime.blake3));

    const entry = new EntryDriverKvStore({
      namespaceScheme,
      subspaceScheme,
      pathScheme,
      payloadScheme: makePayloadScheme(runtime.blake3),
      getPayloadLength: (digest) => payload.length(digest),
      fingerprintScheme: fingerprintScheme,
      kvDriver: new KvDriverInMemory(),
    });

    return Promise.resolve({
      entry,
      payload,
    });
  }
}
