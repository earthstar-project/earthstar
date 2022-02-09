import { Rpc, SuperbusMap } from "../../deps.ts";

import { WorkspaceAddress } from "../util/doc-types.ts";
import { IStorageAsync } from "../storage/storage-types.ts";
import { IPeer, PeerId } from "./peer-types.ts";
import { Syncer } from "../syncer/syncer.ts";
import { SyncerBag } from "../syncer/_syncer-bag.ts";

import { randomId } from "../util/misc.ts";

//--------------------------------------------------

import { Logger } from "../util/log.ts";
const logger = new Logger("peer", "blueBright");
const J = JSON.stringify;

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
        const keys = [...this.storageMap.keys()];
        keys.sort();
        return keys;
    }
    storages(): IStorageAsync[] {
        const keys = [...this.storageMap.keys()];
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
        const existingStorage = this.storageMap.get(storage.workspace);
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

    //----------------------------------------------
    // Syncing stuff

    // A few variables to store syncers for re-use.
    _httpSyncer: Syncer<Rpc.TransportHttpClient<SyncerBag>> | null = null;
    _localSyncer: Syncer<Rpc.TransportLocal<SyncerBag>> | null = null;
    _targetLocalSyncers: Map<string, Syncer<Rpc.TransportLocal<SyncerBag>>> = new Map();

    _addOrGetHttpSyncer(): Syncer<Rpc.TransportHttpClient<SyncerBag>> {
        if (!this._httpSyncer) {
            this._httpSyncer = new Syncer(this, (methods) => {
                return new Rpc.TransportHttpClient({
                    deviceId: this.peerId,
                    methods,
                });
            });
        }

        return this._httpSyncer;
    }

    _addOrGetLocalSyncer(): Syncer<Rpc.TransportLocal<SyncerBag>> {
        if (!this._localSyncer) {
            this._localSyncer = new Syncer(this, (methods) => {
                return new Rpc.TransportLocal({
                    deviceId: this.peerId,
                    methods,
                    description: `Local:${this.peerId}}`,
                });
            });
        }

        return this._localSyncer;
    }

    /**
     * Begin synchronising with something with a remote or local peer.
     * @param target - A HTTP URL, Websocket URL, or an instance of `Peer`.
     * @returns A function which stops the synchronisation when called.
     */
    sync(target: IPeer | string) {
        try {
            // Check if it's a URL of some kind.
            const url = new URL(target as string);

            // Add it to the HTTP syncer
            // TODO: Check if the protocol indicates HTTP or Websockets
            const httpSyncer = this._addOrGetHttpSyncer();
            const connection = httpSyncer.transport.addConnection(url.toString());

            return () => {
                connection.close();
            };
        } catch {
            // Not a URL, so it must be a peer.
            const localSyncer = this._addOrGetLocalSyncer();

            // Make sure a peer can't sync with itself — seems bad.
            if (this === target) {
                return () => {};
            }

            // Check if there's already a sync operation with this Peer
            const maybeExistingSyncer = this._targetLocalSyncers.get((target as Peer).peerId);
            if (maybeExistingSyncer) {
                return () => {
                    maybeExistingSyncer.close();
                };
            }

            // Otherwise create a new syncer and add it to a private set of target syncers
            const otherSyncer = new Syncer(target as Peer, (methods) => {
                return new Rpc.TransportLocal({
                    deviceId: (target as Peer).peerId,
                    methods,
                    description: (target as Peer).peerId,
                });
            });
            this._targetLocalSyncers.set((target as Peer).peerId, otherSyncer);
            localSyncer.transport.addConnection(
                otherSyncer.transport,
            );

            return () => {
                // Remove the target syncer and close it — this will also close the connection from our Peer's side.
                this._targetLocalSyncers.delete((target as Peer).peerId);
                otherSyncer.close();
            };
        }
    }

    /** Stop all synchronisations. */
    stopSyncing() {
        if (this._httpSyncer) {
            this._httpSyncer.close();
            this._httpSyncer = null;
        }

        if (this._localSyncer) {
            this._targetLocalSyncers.forEach((targetSyncer) => {
                targetSyncer.close();
            });
            this._targetLocalSyncers.clear();
            this._localSyncer.close();
            this._localSyncer = null;
        }
    }
}
