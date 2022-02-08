import { Rpc, SuperbusMap } from "../../deps.ts";

import { WorkspaceAddress } from "../util/doc-types.ts";
import { IStorageAsync } from "../storage/storage-types.ts";
import { IPeer, PeerId } from "./peer-types.ts";
import { Syncer } from "../syncer/syncer.ts";

import { randomId } from "../util/misc.ts";

//--------------------------------------------------

import { Logger } from "../util/log.ts";
let logger = new Logger("peer", "blueBright");
let J = JSON.stringify;

//================================================================================

/** Holds many shares' replicas and manages their synchronisation with other peers. Recommended as the point of contact between your application and Earthstar shares. */
export class Peer implements IPeer {
    peerId: PeerId;

    //bus: Superbus<PeerEvent>;
    storageMap: SuperbusMap<WorkspaceAddress, IStorageAsync>;
    constructor() {
        logger.debug("constructor");
        //this.bus = new Superbus<PeerEvent>();
        this.storageMap = new SuperbusMap<WorkspaceAddress, IStorageAsync>();
        this.peerId = "peer:" + randomId();
    }

    //--------------------------------------------------
    // getters

    hasWorkspace(workspace: WorkspaceAddress): boolean {
        return this.storageMap.has(workspace);
    }
    workspaces(): WorkspaceAddress[] {
        let keys = [...this.storageMap.keys()];
        keys.sort();
        return keys;
    }
    storages(): IStorageAsync[] {
        let keys = [...this.storageMap.keys()];
        keys.sort();
        return keys.map((key) => this.storageMap.get(key) as IStorageAsync);
    }
    size(): number {
        return this.storageMap.size;
    }
    getStorage(ws: WorkspaceAddress): IStorageAsync | undefined {
        return this.storageMap.get(ws);
    }

    //--------------------------------------------------
    // setters

    async addStorage(storage: IStorageAsync): Promise<void> {
        logger.debug(`addStorage(${J(storage.workspace)})`);
        if (this.storageMap.has(storage.workspace)) {
            logger.debug(`already had a storage with that workspace`);
            throw new Error(
                `Peer.addStorage: already has a storage with workspace ${
                    J(storage.workspace)
                }.  Don't add another one.`,
            );
        }
        await this.storageMap.set(storage.workspace, storage);
        logger.debug(`    ...addStorage: done`);
    }
    async removeStorageByWorkspace(workspace: WorkspaceAddress): Promise<void> {
        logger.debug(`removeStorageByWorkspace(${J(workspace)})`);
        await this.storageMap.delete(workspace);
    }
    async removeStorage(storage: IStorageAsync): Promise<void> {
        let existingStorage = this.storageMap.get(storage.workspace);
        if (storage === existingStorage) {
            logger.debug(`removeStorage(${J(storage.workspace)})`);
            await this.removeStorageByWorkspace(storage.workspace);
        } else {
            logger.debug(
                `removeStorage(${
                    J(storage.workspace)
                }) -- same workspace but it's a different instance now; ignoring`,
            );
        }
    }

    /**
     * Begin an ongoing synchronisation with something like a replica server or another local peer.
     * @returns A function which stops the synchronisation when called.
     */
    sync(target: IPeer | string) {
        try {
            // Check if it's a URL of some kind.
            const url = new URL(target as string);

            // TODO: Check if the protocol indicates HTTP or Websockets

            const httpSyncer = new Syncer(this, (methods) => {
                return new Rpc.TransportHttpClient({
                    deviceId: this.peerId,
                    methods,
                });
            });

            httpSyncer.transport.addConnection(url.toString());

            return () => {
                httpSyncer.close();
            };
        } catch {
            // Not a URL, so it must be a peer.
            const localSyncer = new Syncer(this, (methods) => {
                return new Rpc.TransportLocal({
                    deviceId: this.peerId,
                    methods,
                    description: `${this.peerId} <> ${(target as Peer).peerId}`,
                });
            });

            const otherSyncer = new Syncer(target as Peer, (methods) => {
                return new Rpc.TransportLocal({
                    deviceId: (target as Peer).peerId,
                    methods,
                    description: `${this.peerId} <> ${(target as Peer).peerId}`,
                });
            });

            return () => {
                localSyncer.close();
                otherSyncer.close();
            };
        }
    }
}
