import { Crypto } from "../crypto/crypto.ts";
import {
  DEFAULT_FORMAT,
  getFormatIntersection,
  getFormatsWithFallback,
} from "../formats/util.ts";
import { DefaultFormats, FormatsArg } from "../formats/format_types.ts";
import { IPeer } from "../peer/peer-types.ts";
import { BlockingBus } from "../streams/stream_utils.ts";
import { AuthorAddress, Path, ShareAddress } from "../util/doc-types.ts";

import { randomId } from "../util/misc.ts";
import {
  ISyncPartner,
  SyncAgentEvent,
  SyncAppetite,
  SyncerEvent,
  SyncerOpts,
  SyncerStatus,
} from "./syncer_types.ts";
import { SyncAgent } from "./sync_agent.ts";
import { TransferManager } from "./transfer_manager.ts";
import { MultiDeferred } from "./multi_deferred.ts";
import { AsyncQueue, deferred } from "../../deps.ts";
import { SyncerManager } from "./syncer_manager.ts";

/** Syncs the data of a Peer's replicas with that of another peer.
 *
 * ```ts
 * const syncer = peer.sync("https://my.server");
 *
 * syncer.onStatusChange((newStatus) => {
 *  console.log(newStatus);
 * });
 *
 * await syncer.isDone();
 *
 * console.log('Sync complete!');
 * ```
 */
export class Syncer<IncomingTransferSourceType, FormatsType = DefaultFormats> {
  peer: IPeer;
  id = randomId();
  private manager: SyncerManager;
  private partner: ISyncPartner<IncomingTransferSourceType>;
  private syncAgents = new Map<ShareAddress, SyncAgent<FormatsType>>();
  private syncAgentQueues = new Map<ShareAddress, AsyncQueue<SyncAgentEvent>>();
  private appetite: SyncAppetite;
  private statusBus = new BlockingBus<SyncerStatus>();
  private formats: FormatsArg<FormatsType>;
  private transferManager: TransferManager<
    FormatsType,
    IncomingTransferSourceType
  >;

  private partnerIsFulfilled = deferred<true>();
  private isDoneMultiDeferred = new MultiDeferred();
  private heartbeatInterval: number;

  constructor(opts: SyncerOpts<FormatsType, IncomingTransferSourceType>) {
    // Have to do this because we'll be using these values in a context where 'this' is different
    // (the streams below)
    this.manager = opts.manager;
    this.peer = opts.manager.peer;
    this.appetite = opts.partner.syncAppetite;

    this.formats = getFormatsWithFallback(opts.formats);
    this.partner = opts.partner;

    this.transferManager = new TransferManager(
      {
        partner: this.partner,
        formats: this.formats,
      },
    );

    this.transferManager.onReportUpdate(async () => {
      await this.statusBus.send(this.getStatus());
    });

    this.heartbeatInterval = setInterval(() => {
      this.partner.sendEvent({ kind: "HEARTBEAT" });
    }, 1000);

    (async () => {
      try {
        for await (const event of opts.partner.getEvents()) {
          this.handleIncomingEvent(event);
        }
      } catch (err) {
        this.cancel(err || "Partner disconnected");
      }
    })();

    // Send off a salted handshake event
    const salt = randomId();
    Promise.all(
      this.peer.shares().map((ws) => saltAndHashShare(salt, ws)),
    ).then((saltedShares) => {
      this.partner.sendEvent({
        kind: "DISCLOSE",
        salt,
        syncerId: this.id,
        shares: saltedShares,
        formats: this.formats
          ? this.formats.map((f) => f.id)
          : [DEFAULT_FORMAT.id],
        canRespond: false,
      });
    });

    this.transferManager.transfersRequestedByUsFinished().then(async () => {
      if (opts.partner.syncAppetite === "continuous") {
        return;
      }

      await this.partner.sendEvent({
        kind: "SYNCER_FULFILLED",
      });

      await this.partnerIsFulfilled;

      clearInterval(this.heartbeatInterval);

      await this.partner.closeConnection();

      this.isDoneMultiDeferred.resolve();
    });

    this.peer.onReplicasChange(async (replicas) => {
      if (this.appetite === "once") {
        return;
      }

      const shares = Array.from(replicas.keys());

      for (const [address, agent] of this.syncAgents) {
        if (shares.includes(address) === false) {
          await agent.cancel("Replica was removed from peer.");
          this.syncAgents.delete(address);
        }
      }

      // send out disclose event again
      const salt = randomId();
      Promise.all(
        shares.map((ws) => saltAndHashShare(salt, ws)),
      ).then((saltedShares) => {
        this.partner.sendEvent({
          kind: "DISCLOSE",
          salt,
          syncerId: this.id,
          shares: saltedShares,
          formats: this.formats
            ? this.formats.map((f) => f.id)
            : [DEFAULT_FORMAT.id],
          canRespond: true,
        });
      });
    });
  }

  private addShare(
    address: string,
    formats: FormatsArg<FormatsType>,
    initiateMessaging: boolean,
  ) {
    // Bail if we already have a sync agent for this share.
    if (this.syncAgents.has(address)) {
      return;
    }

    const replica = this.peer.getReplica(address);

    if (!replica) {
      console.error(
        "Couldn't get the replica for a share we had in common.",
      );
      return;
    }

    const agent = new SyncAgent({
      replica,
      formats,
      syncerManager: this.manager,
      transferManager: this.transferManager,
      initiateMessaging: initiateMessaging,
      payloadThreshold: this.partner.payloadThreshold,
      rangeDivision: this.partner.rangeDivision,
      syncAppetite: this.appetite,
    });

    agent.onStatusUpdate(() => {
      this.statusBus.send(this.getStatus());
    });

    this.syncAgents.set(address, agent);
    this.transferManager.registerSyncAgent(agent);

    const existingQueue = this.syncAgentQueues.get(address);
    let queueToUse: AsyncQueue<SyncAgentEvent>;

    if (!existingQueue) {
      const queue = new AsyncQueue<SyncAgentEvent>();
      queueToUse = queue;
      this.syncAgentQueues.set(address, queue);
    } else {
      queueToUse = existingQueue;
    }

    (async () => {
      for await (const incomingEvent of queueToUse) {
        agent.sendEvent(incomingEvent);
      }
    })();

    (async () => {
      for await (const event of agent.events()) {
        this.partner.sendEvent({
          to: address,
          ...event,
        });
      }
    })();
  }

  /** Handle inbound events from the other peer. */
  private async handleIncomingEvent(event: SyncerEvent) {
    switch (event.kind) {
      // Handle an incoming salted handsake
      case "DISCLOSE": {
        const intersectingFormats = getFormatIntersection(
          event.formats,
          this.formats,
        );

        if (intersectingFormats.length === 0) {
          break;
        }

        const serverSaltedSet = new Set<string>(event.shares);
        const commonShareSet = new Set<ShareAddress>();
        const uncommonShareSet = new Set<ShareAddress>();

        // For each of our own shares, hash with the salt given to us by the event
        // If it matches any of the hashes sent by the other side, we have a share in common.
        for (const planeAddr of this.peer.shares()) {
          const saltedAddr = await saltAndHashShare(event.salt, planeAddr);
          if (serverSaltedSet.has(saltedAddr)) {
            commonShareSet.add(planeAddr);
          } else {
            uncommonShareSet.add(planeAddr);
          }
        }

        const initiateMessaging = this.id > event.syncerId;

        for (const share of commonShareSet) {
          this.addShare(share, intersectingFormats, initiateMessaging);
        }

        for (const share of uncommonShareSet) {
          const syncAgent = this.syncAgents.get(share);

          if (syncAgent) {
            syncAgent.cancel("No longer in common with the other peer.");
            this.syncAgents.delete(share);
          }
        }

        this.transferManager.registerOtherSyncerId(event.syncerId);

        if (this.appetite === "once") {
          this.transferManager.allSyncAgentsKnown();
        }

        if (event.canRespond) {
          const salt = randomId();
          Promise.all(
            this.peer.shares().map((ws) => saltAndHashShare(salt, ws)),
          ).then((saltedShares) => {
            this.partner.sendEvent({
              kind: "DISCLOSE",
              salt,
              syncerId: this.id,
              shares: saltedShares,
              formats: this.formats
                ? this.formats.map((f) => f.id)
                : [DEFAULT_FORMAT.id],
              canRespond: false,
            });
          });
        }

        if (commonShareSet.size === 0 && this.appetite === "once") {
          this.partner.sendEvent({
            "kind": "SYNCER_FULFILLED",
          });
        }

        break;
      }
      case "SYNCER_FULFILLED": {
        this.partnerIsFulfilled.resolve();
        break;
      }
      case "HEARTBEAT": {
        break;
      }

      // Pass on to the sync agent.

      default: {
        // Get the share address;
        const { to } = event;

        const agentQueue = this.syncAgentQueues.get(to);

        if (!agentQueue) {
          const queue = new AsyncQueue<SyncAgentEvent>();
          queue.push(event);
          this.syncAgentQueues.set(to, queue);
          break;
        }

        agentQueue.push(event);
      }
    }
  }

  /** Get the status of all shares' syncing progress. */
  getStatus(): SyncerStatus {
    const status: SyncerStatus = {};

    for (const [shareAddr, agent] of this.syncAgents) {
      status[shareAddr] = {
        docs: agent.getStatus(),
        attachments: this.transferManager.getReport()[shareAddr] || [],
      };
    }

    return status;
  }

  /** Fires the provided callback whenever any shares' syncing progress changes. */
  onStatusChange(callback: (status: SyncerStatus) => void): () => void {
    return this.statusBus.on(callback);
  }

  /** Stop syncing. */
  async cancel(reason?: Error | string) {
    this.isDoneMultiDeferred.reject(reason);

    for (const [_addr, agent] of this.syncAgents) {
      await agent.cancel();
    }

    clearInterval(this.heartbeatInterval);

    this.transferManager.cancel();

    await this.partner.closeConnection();
  }

  // externally callable... to get a readable...
  /** Handle a transfer request which came out of band. This method is mostly used by other syncing APIs. */
  handleTransferRequest(
    { shareAddress, path, author, source, kind, formatName }: {
      shareAddress: string;
      formatName: string;
      path: Path;
      author: AuthorAddress;
      source: IncomingTransferSourceType;
      kind: "upload" | "download";
    },
  ) {
    if (this.isDoneMultiDeferred.state === "rejected") {
      return;
    }

    const replica = this.peer.getReplica(shareAddress);

    if (!replica) {
      return;
    }

    let counterpartId = "unused";

    if (kind === "upload") {
      // Someone is uploading to us...
      // Get their counterpart Id.
      const agent = this.syncAgents.get(shareAddress);

      if (agent) {
        counterpartId = agent.counterpartId;
      }
    }

    return this.transferManager.handleTransferRequest(
      {
        replica,
        author,
        formatName,
        kind,
        path,
        source,
        counterpartId,
      },
    );
  }

  /** If the syncer was configured with the `appetite: 'once'`, this promise will resolve when all the partner's existing documents and attachments have synchronised. */
  isDone() {
    return this.isDoneMultiDeferred.getPromise();
  }
}

function saltAndHashShare(
  salt: string,
  share: ShareAddress,
): Promise<string> {
  return Crypto.sha256base32(salt + share + salt);
}
