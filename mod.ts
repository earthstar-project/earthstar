/**
 * [Earthstar](https://earthstar-project.org) is a general purpose distributed data store, designed with the social realities of peer-to-peer computing kept in mind. It is powered by [Willow](https://willowprotocol.org).
 *
 * To get started, try instantiating a new {@linkcode Peer}:
 *
 * ```
 * const peer = new Peer({
 *   password: "password1234",
 *   runtime: new RuntimeDriverUniversal(),
 *   storage: new StorageDriverMemory();,
 * });
 * ```
 *
 * @module
 */
export type { AuthOpts } from "./src/auth/auth.ts";
export { Auth } from "./src/auth/auth.ts";

export type { Blake3Digest, Blake3Driver } from "./src/blake3/types.ts";
export type { Ed25519Driver } from "./src/cinn25519/types.ts";

export { Cap } from "./src/caps/cap.ts";

export { Path } from "./src/path/path.ts";

export type {
  CapSelector,
  PeerOpts,
  RuntimeDriver,
  StorageDriver,
} from "./src/peer/types.ts";

export { Peer } from "./src/peer/peer.ts";

export { StorageDriverMemory } from "./src/peer/storage_drivers/memory.ts";

export { RuntimeDriverUniversal } from "./src/runtime/driver_universal.ts";

export type { ServerExtension } from "./src/server/extensions/extension.ts";

export type {
  IdentityKeypair,
  IdentityTag,
} from "./src/identifiers/identity.ts";
export type { ShareKeypair, ShareTag } from "./src/identifiers/share.ts";

export type {
  Document,
  Payload,
  Query,
  SetEvent,
  StoreDriverOpts,
} from "./src/store/types.ts";

export { Store } from "./src/store/store.ts";

export { syncInMemory } from "./src/syncer/sync_in_memory.ts";

export type {
  ReadAuthorisation,
  SyncerOpts,
  SyncInterests,
  Transport,
} from "./src/syncer/syncer.ts";

export { Syncer } from "./src/syncer/syncer.ts";

export {
  AuthorisationError,
  EarthstarError,
  isErr,
  notErr,
  ValidationError,
} from "./src/util/errors.ts";
