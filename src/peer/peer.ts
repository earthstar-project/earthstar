import { ShareAddress } from "../util/doc-types.ts";
import { IPeer } from "./peer-types.ts";

//--------------------------------------------------

import { Logger } from "../util/log.ts";

import { Replica } from "../replica/replica.ts";
import { Syncer } from "../syncer/syncer.ts";

import { BlockingBus } from "../streams/stream_utils.ts";
import { PartnerWebClient } from "../syncer/partner_web_client.ts";
import { PartnerLocal } from "../syncer/partner_local.ts";
import { FormatsArg } from "../formats/format_types.ts";

const logger = new Logger("peer", "orangeRed");
const J = JSON.stringify;

//================================================================================

/** Holds many shares' replicas and manages their synchronisation with other peers. Recommended as the point of contact between your application and Earthstar shares. */
export class Peer implements IPeer {
  private replicaEventBus = new BlockingBus<Map<ShareAddress, Replica>>();

  /** A subscribable map of the replicas stored in this peer. */
  replicaMap: Map<ShareAddress, Replica> = new Map();

  constructor() {
    logger.debug("constructor");
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
  replicas(): Replica[] {
    const keys = [...this.replicaMap.keys()];
    keys.sort();
    return keys.map((key) => this.replicaMap.get(key) as Replica);
  }
  /** The number of replicas held by this peer */
  size(): number {
    return this.replicaMap.size;
  }
  getReplica(ws: ShareAddress): Replica | undefined {
    return this.replicaMap.get(ws);
  }

  //--------------------------------------------------
  // setters

  async addReplica(replica: Replica): Promise<void> {
    logger.debug(`addReplica(${J(replica.share)})`);
    if (this.replicaMap.has(replica.share)) {
      logger.debug(`already had a replica with that share`);
      throw new Error(
        `Peer.addReplica: already has a replica with share ${
          J(replica.share)
        }.  Don't add another one.`,
      );
    }
    this.replicaMap.set(replica.share, replica);
    await this.replicaEventBus.send(this.replicaMap);
    logger.debug(`    ...addReplica: done`);
  }
  async removeReplicaByShare(share: ShareAddress): Promise<void> {
    logger.debug(`removeReplicaByShare(${J(share)})`);
    this.replicaMap.delete(share);
    await this.replicaEventBus.send(this.replicaMap);
  }
  async removeReplica(
    replica: Replica,
  ): Promise<void> {
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

  /**
   * Begin synchronising with a remote or local peer.
   * @param target - A HTTP URL or `Peer` instance.
   * @param live - Whether the connection should be kept open for newly written docs, or stop after an initial sync.
   * @param formats - Optional. Which document formats to sync. Defaults to `es.5`.
   */
  sync<F>(
    target: IPeer | string,
    live = false,
    formats?: FormatsArg<F>,
  ): Syncer<undefined, F> {
    try {
      const partner = new PartnerWebClient({
        url: target as string,
        mode: live ? "live" : "once",
      });

      const syncer = new Syncer({
        partner,
        mode: live ? "live" : "once",
        peer: this,
        formats,
      });

      return syncer;
    } catch {
      if (target instanceof Peer) {
        const syncer = new Syncer({
          peer: this,
          partner: new PartnerLocal(
            target as IPeer,
            this,
            live ? "live" : "once",
            formats,
          ),
          mode: live ? "live" : "once",
          formats,
        });

        return syncer;
      }

      // This shouldn't happen.
      console.error(
        "Provided an invalid target for syncing to a peer:",
        target,
      );
      return undefined as never;
    }
  }

  //----------------------------------------------
  // Subscribe stuff

  /** Fires a given callback whenever the Peer's store of replicas changes. */
  onReplicasChange(
    callback: (map: Map<ShareAddress, Replica>) => void | Promise<void>,
  ) {
    return this.replicaEventBus.on(callback);
  }
}
