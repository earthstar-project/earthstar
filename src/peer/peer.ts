import {
  ITransport,
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
import { SyncSessionStatus } from "../syncer/syncer-types.ts";
const logger = new Logger("peer", "orangeRed");

const J = JSON.stringify;

//================================================================================

/** Holds many shares' replicas and manages their synchronisation with other peers. Recommended as the point of contact between your application and Earthstar shares. */
export class Peer implements IPeer {
  peerId: PeerId;

  /** A subscribable map of the replicas stored in this peer. */
  replicaMap: SuperbusMap<ShareAddress, IReplica> = new SuperbusMap();

  /** A subscribable map of each of this Peer's sync operations' statuses */
  syncerStatuses: SuperbusMap<string, Record<ShareAddress, SyncSessionStatus>> =
    new SuperbusMap();

  constructor() {
    logger.debug("constructor");

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
  private httpSyncer: Syncer<TransportHttpClient<SyncerBag>> | null = null;
  private websocketSyncer: Syncer<TransportWebsocketClient<SyncerBag>> | null =
    null;
  private localSyncer: Syncer<TransportLocal<SyncerBag>> | null = null;
  private targetLocalSyncers: Map<string, Syncer<TransportLocal<SyncerBag>>> =
    new Map();

  private subscribeSyncerStatuses<TransportType extends ITransport<SyncerBag>>(
    syncer: Syncer<TransportType>,
  ) {
    syncer.syncStatuses.bus.on("*", async () => {
      for (const [connectionDesc, statuses] of syncer.syncStatuses.entries()) {
        await this.syncerStatuses.set(connectionDesc, statuses);
      }
    });

    syncer.syncStatuses.bus.on("deleted", (_channel, data) => {
      this.syncerStatuses.delete(data.key);
    });
  }

  private addOrGetWebsocketSyncer(): Syncer<
    TransportWebsocketClient<SyncerBag>
  > {
    if (!this.websocketSyncer) {
      this.websocketSyncer = new Syncer(this, (methods) => {
        return new TransportWebsocketClient({
          deviceId: this.peerId,
          methods,
        });
      });

      this.subscribeSyncerStatuses(this.websocketSyncer);
    }

    return this.websocketSyncer;
  }

  private addOrGetHttpSyncer(): Syncer<TransportHttpClient<SyncerBag>> {
    if (!this.httpSyncer) {
      this.httpSyncer = new Syncer(this, (methods) => {
        return new TransportHttpClient({
          deviceId: this.peerId,
          methods,
        });
      });

      this.subscribeSyncerStatuses(this.httpSyncer);
    }

    return this.httpSyncer;
  }

  private addOrGetLocalSyncer(): Syncer<TransportLocal<SyncerBag>> {
    if (!this.localSyncer) {
      this.localSyncer = new Syncer(this, (methods) => {
        return new TransportLocal({
          deviceId: this.peerId,
          methods,
          description: `Local:${this.peerId}}`,
        });
      });

      this.subscribeSyncerStatuses(this.localSyncer);
    }

    return this.localSyncer;
  }

  /**
   * Begin synchronising with a remote or local peer.
   * @param target - A HTTP URL, Websocket URL, or an instance of `Peer`.
   * @returns A function which stops the synchronisation when called.
   */
  sync(target: IPeer | string) {
    try {
      // Check if it's a URL of some kind.
      const url = new URL(target as string);

      // Check if it's a websocket syncer
      if (url.protocol.startsWith("ws")) {
        const websocketSyncer = this.addOrGetWebsocketSyncer();
        const connection = websocketSyncer.transport.addConnection(
          url.toString(),
        );

        return () => {
          connection.close();
        };
      }

      // Set up a HttpSyncer
      const httpSyncer = this.addOrGetHttpSyncer();
      const connection = httpSyncer.transport.addConnection(url.toString());

      return () => {
        connection.close();
      };
    } catch {
      // Not a URL, so it must be a peer.
      const localSyncer = this.addOrGetLocalSyncer();

      // Make sure a peer can't sync with itself — seems bad.
      if (this === target) {
        return () => {};
      }

      // Check if there's already a sync operation with this Peer
      const maybeExistingSyncer = this.targetLocalSyncers.get(
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
      this.targetLocalSyncers.set((target as Peer).peerId, otherSyncer);
      localSyncer.transport.addConnection(
        otherSyncer.transport,
      );

      return () => {
        // Remove the target syncer and close it — this will also close the connection from our Peer's side.
        this.targetLocalSyncers.delete((target as Peer).peerId);
        otherSyncer.close();
      };
    }
  }

  /** Stop all synchronisations. */
  stopSyncing() {
    if (this.httpSyncer) {
      this.httpSyncer.close();
      this.httpSyncer = null;
    }

    if (this.websocketSyncer) {
      this.websocketSyncer.close();
      this.websocketSyncer = null;
    }

    if (this.localSyncer) {
      this.targetLocalSyncers.forEach((targetSyncer) => {
        targetSyncer.close();
      });
      this.targetLocalSyncers.clear();
      this.localSyncer.close();
      this.localSyncer = null;
    }
  }

  /** Sync with many peers until there is nothing left to pull, and then stops.
   * @param targets - An array made up of HTTP URLs, Websocket URLs, or `Peer` instances.
   * @returns A report of all the peers which were synced with.
   */
  async syncUntilCaughtUp(targets: (IPeer | string)[]) {
    let unsubscribeFromBus: (() => void) | null = null;

    const stopSyncers = [];

    for (const target of targets) {
      stopSyncers.push(this.sync(target));
    }

    const report = await new Promise<
      Record<string, Record<ShareAddress, SyncSessionStatus>>
    >(
      (resolve) => {
        // Every time the syncer statuses change...
        unsubscribeFromBus = this.syncerStatuses.bus.on("*", () => {
          // This is an iterable of record of shares to sync statuses for each.
          const statuses = this.syncerStatuses.values();

          // Make a list of all sync ops' 'isCaughtUp' property.
          const caughtUps = [];

          for (const status of statuses) {
            for (const shareAddress in status) {
              caughtUps.push(status[shareAddress].isCaughtUp);
              caughtUps.push(status[shareAddress].partnerIsCaughtUp);
            }
          }

          // If all of them are caught up, report.
          if (caughtUps.every((isCaughtUp) => isCaughtUp)) {
            const report: Record<
              string,
              Record<ShareAddress, SyncSessionStatus>
            > = {};

            // Need to turn the SuperbusMap into a plain object.
            for (
              const [peerDescription, statuses] of this.syncerStatuses.entries()
            ) {
              report[peerDescription] = statuses;
            }

            resolve(report);
          }
        });
      },
    );

    stopSyncers.forEach((stop) => stop());

    if (unsubscribeFromBus !== null) {
      (unsubscribeFromBus as () => void)();
    }

    return Promise.resolve(report);
  }
}
