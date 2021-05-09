import { WorkspaceAddress } from '../util/doc-types';
import { IStorageAsync } from '../storage/storage-types';
import { ICrypto } from '../crypto/crypto-types';

//================================================================================
// PEER

export type PeerId = string;

export interface IPeer {
    // TODO: oops, or should we have storage IDs instead of peer IDs?
    peerId: PeerId,

    // getters
    hasWorkspace(workspace: WorkspaceAddress): boolean;
    workspaces(): WorkspaceAddress[];
    storages(): IStorageAsync[];
    size(): number;

    // setters
    addStorage(storage: IStorageAsync): Promise<void>;
    removeStorageByWorkspace(workspace: WorkspaceAddress): Promise<void> 
    removeStorage(storage: IStorageAsync): Promise<void>;
}

//================================================================================
// CLIENT AND SERVER

export interface SaltAndSaltedWorkspaces {
    peerId: PeerId,
    salt: string,
    saltedWorkspaces: string[],
}

export interface CommonWorkspacesAndPeerId {
    commonWorkspaces: WorkspaceAddress[],
    serverPeerId: PeerId,
}

// ok this isn't a type, but I put it here anyway.
export let saltAndHashWorkspace = (crypto: ICrypto, salt: string, workspace: WorkspaceAddress): string =>
    crypto.sha256base32(salt + workspace + salt);

// one server can talk to many clients.

export interface IPeerClient {
    syncWithPeer(server: IPeerServer): Promise<void>;
    discoverCommonWorkspacesAndServerPeerId(server: IPeerServer): Promise<CommonWorkspacesAndPeerId>;
}

export interface IPeerServer {
    saltedWorkspaces(): Promise<SaltAndSaltedWorkspaces>
    // storageDetails(workspaces): Promise<TODO>
}
