import {
  SuperbusMap,
  TransportHttpClient,
  TransportLocal,
  TransportWebsocketClient,
} from "../../deps.ts";

import { ShareAddress } from "../util/doc-types.ts";
import { IReplica } from "../replica/replica-types.ts";
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
  replicaMap: SuperbusMap<ShareAddress, IReplica>;
  constructor() {
    logger.debug("constructor");
    //this.bus = new Superbus<PeerEvent>();
    this.replicaMap = new SuperbusMap<ShareAddress, IReplica>();
    this.peerId = "peer:" + randomId();
  }

  //--------------------------------------------------
  // getters

  hasShare(share: ShareAddress): boolean {
    return this.replicaMap.has(share);
  }
  shares(): ShareAddress[] {
    const keys = [...this.replicaMap.keys()];
    keys.sort();
    return keys;
  }
  replicas(): IReplica[] {
    const keys = [...this.replicaMap.keys()];
    keys.sort();
    return keys.map((key) => this.replicaMap.get(key) as IReplica);
  }
  size(): number {
    return this.replicaMap.size;
  }
  getReplica(ws: ShareAddress): IReplica | undefined {
    return this.replicaMap.get(ws);
  }

  //--------------------------------------------------
  // setters

  async addReplica(replica: IReplica): Promise<void> {
    logger.debug(`addReplica(${J(replica.share)})`);
    if (this.replicaMap.has(replica.share)) {
      logger.debug(`already had a replica with that share`);
      throw new Error(
        `Peer.addReplica: already has a replica with share ${
          J(replica.share)
        }.  Don't add another one.`,
      );
    }
    await this.replicaMap.set(replica.share, replica);
    logger.debug(`    ...addReplica: done`);
  }
  async removeReplicaByShare(share: ShareAddress): Promise<void> {
    logger.debug(`removeReplicaByShare(${J(share)})`);
    await this.replicaMap.delete(share);
  }
  async removeReplica(replica: IReplica): Promise<void> {
    const existingReplica = this.replicaMap.get(replica.share);
    if (replica === existingReplica) {
      logger.debug(`removeReplica(${J(replica.share)})`);
      await this.removeReplicaByShare(replica.share);
    } else {
      logger.debug(
        `removeReplica(${
          J(replica.share)
        }) -- same share but it's a different instance now; ignoring`,
      );
    }
  }

  //----------------------------------------------
  // Syncing stuff

  // A few variables to store syncers for re-use.
  _httpSyncer: Syncer<TransportHttpClient<SyncerBag>> | null = null;
  _websocketSyncer: Syncer<TransportWebsocketClient<SyncerBag>> | null = null;
  _localSyncer: Syncer<TransportLocal<SyncerBag>> | null = null;
  _targetLocalSyncers: Map<string, Syncer<TransportLocal<SyncerBag>>> =
    new Map();

  _addOrGetWebsocketSyncer(): Syncer<TransportWebsocketClient<SyncerBag>> {
    if (!this._websocketSyncer) {
      this._websocketSyncer = new Syncer(this, (methods) => {
        return new TransportWebsocketClient({
          deviceId: this.peerId,
          methods,
        });
      });
    }

    return this._websocketSyncer;
  }

  _addOrGetHttpSyncer(): Syncer<TransportHttpClient<SyncerBag>> {
    if (!this._httpSyncer) {
      this._httpSyncer = new Syncer(this, (methods) => {
        return new TransportHttpClient({
          deviceId: this.peerId,
          methods,
        });
      });
    }

    return this._httpSyncer;
  }

  _addOrGetLocalSyncer(): Syncer<TransportLocal<SyncerBag>> {
    if (!this._localSyncer) {
      this._localSyncer = new Syncer(this, (methods) => {
        return new TransportLocal({
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

      // Check if it's a websocket syncer
      if (url.protocol.startsWith("ws")) {
        const websocketSyncer = this._addOrGetWebsocketSyncer();
        const connection = websocketSyncer.transport.addConnection(
          url.toString(),
        );

        return () => {
          connection.close();
        };
      }

      // Set up a HttpSyncer
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
      const maybeExistingSyncer = this._targetLocalSyncers.get(
        (target as Peer).peerId,
      );
      if (maybeExistingSyncer) {
        return () => {
          maybeExistingSyncer.close();
        };
      }

      // Otherwise create a new syncer and add it to a private set of target syncers
      const otherSyncer = new Syncer(target as Peer, (methods) => {
        return new TransportLocal({
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

    if (this._websocketSyncer) {
      this._websocketSyncer.close();
      this._websocketSyncer = null;
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
