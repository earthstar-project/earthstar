export type { AuthOpts } from "./src/auth/auth.ts";
export { Auth } from "./src/auth/auth.ts";

export { Cap } from "./src/caps/cap.ts";

export { Path } from "./src/path/path.ts";

export type {
  PeerOpts,
  RuntimeDriver,
  StorageDriver,
} from "./src/peer/types.ts";

export { Peer } from "./src/peer/peer.ts";

export { StorageDriverMemory } from "./src/peer/storage_drivers/memory.ts";

export { RuntimeDriverUniversal } from "./src/runtime/driver_universal.ts";

export type { ServerExtension } from "./src/server/extensions/extension.ts";

export type {
  Document,
  Payload,
  Query,
  SetEvent,
  StoreDriverOpts,
} from "./src/store/types.ts";

export { Store } from "./src/store/store.ts";

export { syncInMemory } from "./src/syncer/sync_in_memory.ts";

export type { SyncerOpts, SyncInterests } from "./src/syncer/syncer.ts";

export { Syncer } from "./src/syncer/syncer.ts";

export {
  AuthorisationError,
  EarthstarError,
  isErr,
  notErr,
  ValidationError,
} from "./src/util/errors.ts";
