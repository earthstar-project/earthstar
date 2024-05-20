import * as Willow from "@earthstar/willow";
import { type H2CPoint } from "@noble/curves";
import { AuthorisationToken } from "../auth/auth.ts";
import { Capability } from "../caps/types.ts";
import { Base32String } from "../encoding/types.ts";
import {
  IdentityKeypairRaw,
  IdentityPublicKey,
  IdentityTag,
} from "../identifiers/identity.ts";
import { SharePublicKey, ShareTag } from "../identifiers/share.ts";
import { Path } from "../path/path.ts";
import { Blake3Digest, Blake3Driver } from "../blake3/types.ts";
import { RuntimeDriver } from "../peer/types.ts";

export type PreFingerprint = H2CPoint<bigint>;

export type Payload = Willow.Payload;

export type AuthorisationOpts = {
  cap: Capability;
  receiverKeypair: IdentityKeypairRaw;
};

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

export type SetEventFailure = {
  kind: "failure";
  reason: "write_failure" | "invalid_entry" | "pruning_disallowed";
  message: string;
  err: Error | null;
};

export type SetEventPruningPrevented = {
  kind: "pruning_prevented";
  preservedDocuments: Document[];
};

export type SetEventNoOp = {
  kind: "no_op";
  reason: "obsolete_from_same_subspace" | "newer_prefix_found";
};

export type SetEventSuccess = {
  kind: "success";
  /** The successfully created document. */
  document: Document;
  /** The paths of documents deleted by the new document via prefix pruning. */
  pruned: Path[];
};

export type SetEvent =
  | SetEventFailure
  | SetEventPruningPrevented
  | SetEventNoOp
  | SetEventSuccess;

export type IngestEvent = Willow.IngestEvent<
  SharePublicKey,
  IdentityPublicKey,
  ArrayBuffer,
  AuthorisationToken
>;
