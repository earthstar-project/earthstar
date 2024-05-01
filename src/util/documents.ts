import { Entry, Meadowcap, Willow } from "../../deps.ts";
import { IdentityAddress, ShareAddress } from "../crypto/types.ts";
import { encodeBase32 } from "../encoding/base32.ts";
import { Document } from "../store/types.ts";
import { willowToEarthstarPath } from "./path.ts";
import { AuthorisationToken } from "../auth/auth.ts";

export function entryToDocument(
  entry: Entry<ShareAddress, IdentityAddress, ArrayBuffer>,
  payload: Willow.Payload | undefined,
  authToken: AuthorisationToken,
): Document {
  return {
    share: entry.namespaceId,
    identity: entry.subspaceId,
    path: willowToEarthstarPath(entry.path),
    timestamp: entry.timestamp,
    size: entry.payloadLength,
    digest: encodeBase32(new Uint8Array(entry.payloadDigest)),
    signedBy: Meadowcap.getReceiver(authToken.capability),
    payload: payload,
  };
}
