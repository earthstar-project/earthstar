import { WorkspaceAddress } from "../util/doc-types.ts";
import { IStorageAsync } from "../storage/storage-types.ts";

//================================================================================
// PEER

export type PeerId = string;

/** Holds many shares' replicas and manages their synchronisation with other peers. Recommended as the point of contact between your application and Earthstar shares. */
export interface IPeer {
    // TODO: oops, or should we have storage IDs instead of peer IDs?
    peerId: PeerId;

    // getters
    hasWorkspace(workspace: WorkspaceAddress): boolean;
    workspaces(): WorkspaceAddress[];
    storages(): IStorageAsync[];
    size(): number;
    getStorage(ws: WorkspaceAddress): IStorageAsync | undefined;

    // setters
    addStorage(storage: IStorageAsync): Promise<void>;
    removeStorageByWorkspace(workspace: WorkspaceAddress): Promise<void>;
    removeStorage(storage: IStorageAsync): Promise<void>;

    sync(
        target: IPeer | string,
    ): () => void;

    stopSyncing(): void;
}
