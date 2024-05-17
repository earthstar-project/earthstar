import { Entry, Meadowcap, Willow } from "../../deps.ts";
import { encodeBase32 } from "../encoding/base32.ts";
import { Document } from "../store/types.ts";
import { willowToEarthstarPath } from "./path.ts";
import { AuthorisationToken } from "../auth/auth.ts";
import { encodeShareTag, SharePublicKey } from "../identifiers/share.ts";
import {
  encodeIdentityTag,
  IdentityPublicKey,
} from "../identifiers/identity.ts";
import { Blake3Digest } from "../blake3/types.ts";

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
    path: willowToEarthstarPath(entry.path),
    timestamp: entry.timestamp,
    size: entry.payloadLength,
    digest: encodeBase32(new Uint8Array(entry.payloadDigest)),
    signedBy: signedByDisplay,
    payload: payload,
  };
}
