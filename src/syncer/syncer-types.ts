import { PeerId } from "../peer/peer-types.ts";
import { Doc, ShareAddress } from "../util/doc-types.ts";
import { ReplicaId } from "../replica/replica-types.ts";
import { Query } from "../query/query-types.ts";
import { SyncerBag } from "./_syncer-bag.ts";
import { type ITransport } from "../../deps.ts";

export interface ISyncer<TransportType extends ITransport<SyncerBag>> {
  transport: TransportType;
  close(): void;
}

// Salted handshake types

export interface SaltedHandshakeResponse {
  peerId: PeerId;
  salt: string;
  saltedShares: string[];
}

export interface SaltedHandshakeResult {
  partnerPeerId: PeerId;
  partnerLastSeenAt: number;
  commonShares: ShareAddress[];
}

// Share state types

export interface ShareState {
  share: ShareAddress;
  partnerStorageId: ReplicaId;
  partnerMaxLocalIndexOverall: number;
  partnerMaxLocalIndexSoFar: number; // -1 if unknown
  storageId: ReplicaId;
  lastSeenAt: number;
}

export type ShareStateFromResponse = Pick<
  ShareState,
  "share" | "partnerStorageId" | "partnerMaxLocalIndexOverall"
>;

export interface AllShareStatesRequest {
  commonShares: ShareAddress[];
}
export type AllShareStatesResponse = {
  partnerPeerId: PeerId;
  shareStates: Record<
    ShareAddress,
    ShareStateFromResponse
  >;
};
export type AllShareStatesResult = Record<
  ShareAddress,
  ShareState
>;

// Share query types

export interface ShareQueryRequest {
  share: ShareAddress;
  storageId: ReplicaId;
  query: Query;
}
export interface ShareQueryResponse {
  share: ShareAddress;
  storageId: ReplicaId;
  partnerMaxLocalIndexOverall: number;
  docs: Doc[];
}

export interface ShareQueryResult {
  pulled: number;
  lastSeenAt: number;
  shareStates: Record<ShareAddress, ShareState>;
}
