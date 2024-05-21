import type { EntryDriver, KvDriver, PayloadDriver } from "@earthstar/willow";
import type { Blake3Digest, Blake3Driver } from "../blake3/types.ts";
import type { Ed25519Driver } from "../cinn25519/types.ts";
import type {
  IdentityPublicKey,
  IdentityTag,
} from "../identifiers/identity.ts";
import type { SharePublicKey, ShareTag } from "../identifiers/share.ts";
import type { Path } from "../path/path.ts";
import type { PreFingerprint } from "../store/types.ts";

/** A query which selects all capabilities which grant the given parameters. */
export type CapSelector = {
  /** The share the capability grants access to. */
  share: ShareTag;
  capableOf?: {
    /** An optional identity the cap must be able to permit access to. */
    identity?: IdentityTag;
    /** An optional path prefix the cap must be able to permit access to. */
    pathPrefix?: Path;
    /** An optional time range the cap must be able to permit access to..  */
    time?: {
      start: number;
      end?: number;
    };
  }[];
};

/** Instructs Earthstar how to perform ed25519 and BLAKE3 operations on differing runtimes. */
export interface RuntimeDriver {
  /** The driver for ed25519 operations. */
  ed25519: Ed25519Driver<Uint8Array>;
  /** The driver for creating BLAKE3 digests. */
  blake3: Blake3Driver;
}

/** Provides a {@linkcode Peer} with methods for persisting authorisation data (keypairs, caps), as well as Share data for its {@linkcode Store}s. */
export interface StorageDriver {
  /** Provides the storage driver for the {@linkcode Peer}'s {@linkcode Auth} instance. */
  auth: KvDriver;
  /** Get the entry and payload drivers for a {@linkcode Store} for a given {@linkcode SharePublicKey}. */
  getStoreDrivers: (share: SharePublicKey, runtime: RuntimeDriver) => Promise<{
    entry: EntryDriver<
      SharePublicKey,
      IdentityPublicKey,
      Blake3Digest,
      PreFingerprint
    >;
    payload: PayloadDriver<Blake3Digest>;
  }>;
}

/** Options for configuring a {@linkcode Peer}. */
export type PeerOpts = {
  /** A plaintext password used to encrypt sensitive information stored within the peer, such as keypairs or capabilities. */
  password: string;
  storage: StorageDriver;
  runtime: RuntimeDriver;
};
