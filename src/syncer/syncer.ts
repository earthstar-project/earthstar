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
  SyncerEvent,
  SyncerMode,
  SyncerOpts,
  SyncerStatus,
} from "./syncer_types.ts";
import { SyncAgent } from "./sync_agent.ts";
import { TransferManager } from "./transfer_manager.ts";
import { MultiDeferred } from "./multi_deferred.ts";
import { deferred } from "../../deps.ts";

/** Syncs the contents of a Peer's replicas with that of another peer's.  */
export class Syncer<IncomingTransferSourceType, FormatsType = DefaultFormats> {
  peer: IPeer;
  id = randomId();
  private partner: ISyncPartner<IncomingTransferSourceType>;
  private syncAgents = new Map<ShareAddress, SyncAgent<FormatsType>>();
  private mode: SyncerMode;

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
    this.peer = opts.peer;

    this.mode = opts.mode;
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
      for await (const event of opts.partner.getEvents()) {
        this.handleIncomingEvent(event);
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
      });
    });

    this.transferManager.transfersRequestedByUsFinished().then(async () => {
      await this.partner.sendEvent({
        kind: "SYNCER_FULFILLED",
      });
    });

    this.partnerIsFulfilled.then(async () => {
      await this.transferManager.transfersRequestedByUsFinished();

      clearInterval(this.heartbeatInterval);

      this.isDoneMultiDeferred.resolve();
    });

    // TODO: What do we do when transfers change?
    // This should not be permitted during 'once' mode...
    /*
    this.peer.onReplicasChange(() => {
      // send out disclose event again
      const salt = randomId();
      Promise.all(
        this.peer.shares().map((ws) => saltAndHashShare(salt, ws)),
      ).then((saltedShares) => {
        outgoingEventBus.send({
          kind: "DISCLOSE",
          salt,
          shares: saltedShares,
          formats: this.formats
            ? this.formats.map((f) => f.id)
            : [DefaultFormat.id],
        });
      });
    });
    */
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
      mode: this.mode === "once" ? "only_existing" : "live",
      formats,
      transferManager: this.transferManager,
      initiateMessaging: initiateMessaging,
      payloadThreshold: this.partner.payloadThreshold,
      rangeDivision: this.partner.rangeDivision,
    });

    agent.onStatusUpdate(() => {
      this.statusBus.send(this.getStatus());
    });

    this.syncAgents.set(address, agent);
    this.transferManager.registerSyncAgent(agent);

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
    // Handle an incoming salted handsake
    switch (event.kind) {
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

        // For each of our own shares, hash with the salt given to us by the event
        // If it matches any of the hashes sent by the other side, we have a share in common.
        for (const plainWs of this.peer.shares()) {
          const saltedWs = await saltAndHashShare(event.salt, plainWs);
          if (serverSaltedSet.has(saltedWs)) {
            commonShareSet.add(plainWs);
          }
        }

        const initiateMessaging = this.id > event.syncerId;

        for (const share of commonShareSet) {
          this.addShare(share, intersectingFormats, initiateMessaging);
        }

        this.transferManager.registerOtherSyncerId(event.syncerId);
        this.transferManager.allSyncAgentsKnown();

        if (commonShareSet.size === 0 && this.mode === "once") {
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

        const agent = this.syncAgents.get(to);

        // That's no good...
        if (!agent) {
          break;
        }

        agent.sendEvent(event);
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
  async cancel(reason?: any) {
    this.isDoneMultiDeferred.reject(reason);

    for (const [_addr, agent] of this.syncAgents) {
      await agent.cancel();
    }

    clearInterval(this.heartbeatInterval);

    this.transferManager.cancel();
  }

  // externally callable... to get a readable...
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
    const replica = this.peer.getReplica(shareAddress);

    if (!replica) {
      return;
    }

    return this.transferManager.handleTransferRequest(
      {
        replica,
        author,
        formatName,
        kind,
        path,
        source,
      },
    );
  }

  /** If the syncer was configured with the `mode: 'once'`, this promise will resolve when all the partner's existing documents and attachments have synchronised. */
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
