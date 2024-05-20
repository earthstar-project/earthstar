import { EntryDriver, KvDriver, PayloadDriver } from "@earthstar/willow";
import { Blake3Digest, Blake3Driver } from "../blake3/types.ts";
import { Ed25519Driver } from "../cinn25519/types.ts";
import { IdentityPublicKey, IdentityTag } from "../identifiers/identity.ts";
import { SharePublicKey, ShareTag } from "../identifiers/share.ts";
import { Path } from "../path/path.ts";
import { PreFingerprint } from "../store/types.ts";

/** A query which selects all capabilities which include the given parameters. */
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

export interface RuntimeDriver {
  ed25519: Ed25519Driver<Uint8Array>;
  blake3: Blake3Driver;
}

export interface StorageDriver {
  auth: KvDriver;
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

export type PeerOpts = {
  /** A plaintext password used to encrypt sensitive information stored within the peer, such as keypairs or capabilities. */
  password: string;
  storage: StorageDriver;
  runtime: RuntimeDriver;
};
