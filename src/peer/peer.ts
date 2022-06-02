import { ShareAddress } from "../util/doc-types.ts";
import { IPeer } from "./peer-types.ts";

//--------------------------------------------------

import { Logger } from "../util/log.ts";

import { Replica } from "../replica/replica.ts";
import { Syncer } from "../syncer/syncer.ts";

import { BlockingBus } from "../streams/stream_utils.ts";
import { PartnerWeb } from "../syncer/partner_web.ts";
import { PartnerLocal } from "../syncer/partner_local.ts";
import { OptionalFormats } from "../formats/default.ts";

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
   * @param target - A HTTP URL, Websocket URL, or an instance of `Peer`.
   * @param live - Whether the connection should be kept open for newly written docs, or stop after an initial sync.
   */
  sync<F>(
    target: IPeer | string,
    formats: OptionalFormats<F>,
    live?: boolean,
  ): Syncer<F> {
    try {
      // Check if it's a URL of some kind.
      const url = new URL(target as string);

      // Check if it's a web syncer
      const withoutProtocol = `${url.host}${url.pathname}`;

      const isSecure = url.protocol === "https" || url.protocol === "wss";

      try {
        const socket = new WebSocket(
          isSecure ? `wss://${withoutProtocol}` : `ws://${withoutProtocol}`,
        );

        const partner = new PartnerWeb({ socket });

        const syncer = new Syncer({
          partner,
          mode: live ? "live" : "once",
          formats: formats,
          peer: this,
        });

        return syncer;
      } catch {
        // return some kind of error?
      }
    } catch {
      const syncer = new Syncer({
        peer: this,
        partner: new PartnerLocal(
          target as IPeer,
          formats,
          live ? "live" : "once",
        ),
        mode: "live",
        formats,
      });

      return syncer;
    }

    return undefined as never;
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
