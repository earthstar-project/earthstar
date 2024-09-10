import {
  type EntryDriver,
  EntryDriverKvStore,
  type KvDriver,
  type PayloadDriver,
} from "@earthstar/willow";
import {
  KvDriverIndexedDB,
  PayloadDriverIndexedDb,
} from "@earthstar/willow/browser";
import type { RuntimeDriver, StorageDriver } from "../types.ts";
import {
  fingerprintScheme,
  makePayloadScheme,
  namespaceScheme,
  pathScheme,
  subspaceScheme,
} from "../../schemes/schemes.ts";
import {
  encodeShareTag,
  type SharePublicKey,
} from "../../identifiers/share.ts";
import type { Blake3Digest } from "../../blake3/types.ts";
import type { IdentityPublicKey } from "../../identifiers/identity.ts";
import type { PreFingerprint } from "../../store/types.ts";

/** A {@linkcode StorageDriver} for persisting keypairs, caps, entries, and payloads in [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API). */
export class StorageDriverIndexedDB implements StorageDriver {
  auth: KvDriver = new KvDriverIndexedDB("auth");

  getStoreDrivers(share: SharePublicKey, runtime: RuntimeDriver): Promise<{
    entry: EntryDriver<
      SharePublicKey,
      IdentityPublicKey,
      Blake3Digest,
      PreFingerprint
    >;
    payload: PayloadDriver<Blake3Digest>;
  }> {
    const payload = new PayloadDriverIndexedDb(
      encodeShareTag(share),
      makePayloadScheme(runtime.blake3),
    );

    const entry = new EntryDriverKvStore({
      namespaceScheme,
      subspaceScheme,
      pathScheme,
      payloadScheme: makePayloadScheme(runtime.blake3),
      getPayloadLength: (digest) => payload.length(digest),
      fingerprintScheme: fingerprintScheme,
      kvDriver: new KvDriverIndexedDB(encodeShareTag(share)),
    });

    return Promise.resolve({
      entry,
      payload,
    });
  }
}
