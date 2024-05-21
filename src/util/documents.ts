import type * as Willow from "@earthstar/willow";
import * as Meadowcap from "@earthstar/meadowcap";
import { encodeBase32 } from "../encoding/base32.ts";
import type { Document } from "../store/types.ts";
import type { AuthorisationToken } from "../auth/auth.ts";
import { encodeShareTag, type SharePublicKey } from "../identifiers/share.ts";
import {
  encodeIdentityTag,
  type IdentityPublicKey,
} from "../identifiers/identity.ts";
import type { Blake3Digest } from "../blake3/types.ts";
import { Path } from "../path/path.ts";
import type { Entry } from "@earthstar/willow-utils";

export function entryToDocument(
  entry: Entry<SharePublicKey, IdentityPublicKey, Blake3Digest>,
  payload: Willow.Payload | undefined,
  authToken: AuthorisationToken,
): Document {
  const shareDisplay = encodeShareTag(entry.namespaceId);
  const identityDisplay = encodeIdentityTag(entry.subspaceId);
  const signedByDisplay = encodeIdentityTag(
    Meadowcap.getReceiver(authToken.capability),
  );

  return {
    share: shareDisplay,
    identity: identityDisplay,
    path: new Path(entry.path),
    timestamp: entry.timestamp,
    size: entry.payloadLength,
    digest: encodeBase32(new Uint8Array(entry.payloadDigest)),
    signedBy: signedByDisplay,
    payload: payload,
  };
}
