import { PeerId } from "../peer/peer-types.ts";
import { Doc, WorkspaceAddress } from "../util/doc-types.ts";
import { StorageId } from "../storage/storage-types.ts";
import { Query } from "../query/query-types.ts";
import { makeSyncerBag, SyncerBag } from "./_syncer-bag.ts";
import { Rpc } from "../../deps.ts";

export interface ISyncer<TransportType extends Rpc.ITransport<SyncerBag>> {
    transport: TransportType;
    close(): void;
}

// Salted handshake types

export interface SaltedHandshakeResponse {
    peerId: PeerId;
    salt: string;
    saltedWorkspaces: string[];
}

export interface SaltedHandshakeResult {
    partnerPeerId: PeerId;
    partnerLastSeenAt: number;
    commonWorkspaces: WorkspaceAddress[];
}

// Workspace state types

export interface WorkspaceState {
    workspace: WorkspaceAddress;
    partnerStorageId: StorageId;
    partnerMaxLocalIndexOverall: number;
    partnerMaxLocalIndexSoFar: number; // -1 if unknown
    storageId: StorageId;
    maxLocalIndexOverall: number;
    maxLocalIndexSoFar: number; // -1 if unknown
    lastSeenAt: number;
}

export type WorkspaceStateFromResponse = Pick<
    WorkspaceState,
    "workspace" | "partnerStorageId" | "partnerMaxLocalIndexOverall"
>;

export interface AllWorkspaceStatesRequest {
    commonWorkspaces: WorkspaceAddress[];
}
export type AllWorkspaceStatesResponse = {
    partnerPeerId: PeerId;
    workspaceStates: Record<
        WorkspaceAddress,
        WorkspaceStateFromResponse
    >;
};
export type AllWorkspaceStatesResult = Record<
    WorkspaceAddress,
    WorkspaceState
>;

// Workspace query types

export interface WorkspaceQueryRequest {
    workspace: WorkspaceAddress;
    storageId: StorageId;
    query: Query;
}
export interface WorkspaceQueryResponse {
    workspace: WorkspaceAddress;
    storageId: StorageId;
    partnerMaxLocalIndexOverall: number;
    docs: Doc[];
}

export interface WorkspaceQueryResult {
    pulled: number;
    lastSeenAt: number;
    workspaceStates: Record<WorkspaceAddress, WorkspaceState>;
}
