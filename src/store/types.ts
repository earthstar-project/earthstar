import type * as Willow from "@earthstar/willow";
import type { H2CPoint } from "@noble/curves";
import type { AuthorisationToken } from "../auth/auth.ts";
import type { Capability } from "../caps/types.ts";
import type { Base32String } from "../encoding/types.ts";
import type {
  IdentityKeypairRaw,
  IdentityPublicKey,
  IdentityTag,
} from "../identifiers/identity.ts";
import type { SharePublicKey, ShareTag } from "../identifiers/share.ts";
import type { Path } from "../path/path.ts";
import type { Blake3Digest } from "../blake3/types.ts";
import type { RuntimeDriver } from "../peer/types.ts";

export type PreFingerprint = H2CPoint<bigint>;

/** Provides access to the (possibly partial) data associated with a {@linkcode Document}. */
export type Payload = Willow.Payload;

/** The options used to create an {@link AuthorisationToken}. */
export type AuthorisationOpts = {
  cap: Capability;
  receiverKeypair: IdentityKeypairRaw;
};

/** The metadata associated with a {@link Payload}. */
export type Document = {
  /** The share this document belongs to. */
  share: ShareTag;
  /** The identity associated with this document. */
  identity: IdentityTag;
  /** The path this document corresponds to. */
  path: Path;
  /** When the document was written. */
  timestamp: bigint;
  /** The size of the document's payload in bytes. */
  size: bigint;
  /** The BLAKE3 digest of the payload, encoded in base 32. */
  digest: Base32String;
  /** The identity used to authorise this document's creation. */
  signedBy: IdentityTag;
  /** The data associated with this document. */
  payload: Payload | undefined;
};

/** Options for configuring the drivers used by a {@linkcode Store}. */
export type StoreDriverOpts = {
  entryDriver: Willow.EntryDriver<
    SharePublicKey,
    IdentityPublicKey,
    Blake3Digest,
    PreFingerprint
  >;
  payloadDriver: Willow.PayloadDriver<Blake3Digest>;
  runtimeDriver: RuntimeDriver;
};

/** Describes which {@linkcode Document}s should be retrieved. */
export type Query = {
  /** A path all documents must be prefixed by. */
  pathPrefix?: Path;
  /** The identity which wrote the document. */
  identity?: IdentityTag;
  /** The earliest point at which a document was written, in microseconds. */
  timestampGte?: bigint;
  /** The latest  point at which a document was written, in microseconds. */
  timestampLt?: bigint;
  /** The maximum number of documents to be returned. */
  limit?: number;
  /** The maximum cumulative size of all returned documents' payloads. */
  maxSize?: bigint;
  /** The order in which documents will be returned. Uses `path` by default.
   *
   * - `path` - path first, then timestamp, then identity.
   * - `timestamp` - timestamp first, then identity, then path.
   * - `identity` - identity first, then path, then timestamp.
   */
  order?: "path" | "identity" | "timestamp";
  /** Whether to return results in descending order. `false` by default. */
  descending?: boolean;
};

/** Emitted after an attempt to set a document fails. */
export type SetEventFailure = {
  kind: "failure";
  reason: "write_failure" | "invalid_entry" | "pruning_disallowed";
  message: string;
  err: Error | null;
};

/** Emitted after an operation which would otherwise trigger prefix pruning is prevented. */
export type SetEventPruningPrevented = {
  kind: "pruning_prevented";
  preservedDocuments: Document[];
};

/** Emitted when an attempt to set a document does nothing at all. */
export type SetEventNoOp = {
  kind: "no_op";
  reason: "obsolete_from_same_subspace" | "newer_prefix_found";
};

/** Emitted when an attempt to set a document succeeds. */
export type SetEventSuccess = {
  kind: "success";
  /** The successfully created document. */
  document: Document;
  /** The paths of documents deleted by the new document via prefix pruning. */
  pruned: Path[];
};

/** Emitted after an attempt to set a document. */
export type SetEvent =
  | SetEventFailure
  | SetEventPruningPrevented
  | SetEventNoOp
  | SetEventSuccess;

/** Emitted after an attempt to ingest a document from elsewhere. */
export type IngestEvent = Willow.IngestEvent<
  SharePublicKey,
  IdentityPublicKey,
  ArrayBuffer,
  AuthorisationToken
>;
