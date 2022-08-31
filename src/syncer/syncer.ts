import { deferred } from "https://deno.land/std@0.138.0/async/deferred.ts";
import { Crypto } from "../crypto/crypto.ts";
import {
  DEFAULT_FORMAT,
  getFormatIntersection,
  getFormatsWithFallback,
} from "../formats/util.ts";
import { DefaultFormats, FormatsArg } from "../formats/format_types.ts";
import { IPeer } from "../peer/peer-types.ts";

import {
  BlockingBus,
  CloneStream,
  StreamSplitter,
} from "../streams/stream_utils.ts";
import { AuthorAddress, Path, ShareAddress } from "../util/doc-types.ts";

import { randomId } from "../util/misc.ts";
import {
  ISyncPartner,
  SyncAgentEvent,
  SyncerEvent,
  SyncerMode,
  SyncerOpts,
  SyncerStatus,
} from "./syncer_types.ts";
import { SyncAgent } from "./sync_agent.ts";
import { TransferManager } from "./transfer_manager.ts";
import { MultiDeferred } from "./multi_deferred.ts";

/** Syncs the contents of a Peer's replicas with that of another peer's.  */
export class Syncer<IncomingTransferSourceType, FormatsType = DefaultFormats> {
  peer: IPeer;
  id = randomId();
  private partner: ISyncPartner<IncomingTransferSourceType>;
  private outgoingEventBus = new BlockingBus<
    SyncerEvent | { kind: "CMD_FINISHED" }
  >();
  private syncAgents = new Map<ShareAddress, SyncAgent<FormatsType>>();
  private mode: SyncerMode;
  private incomingStreamCloner = new CloneStream<SyncerEvent>();
  private statusBus = new BlockingBus<SyncerStatus>();
  private agentStreamSplitter = new StreamSplitter<SyncerEvent>((chunk) => {
    if (
      chunk.kind === "DISCLOSE" ||
      chunk.kind === "SYNCER_FULFILLED" ||
      chunk.kind === "HEARTBEAT"
    ) {
      return;
    }

    return chunk.to;
  });
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
    const { outgoingEventBus } = this;
    const handleIncomingEvent = this.handleIncomingEvent.bind(this);

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

    this.transferManager.onReportUpdate(() => {
      this.statusBus.send(this.getStatus());
    });

    this.heartbeatInterval = setInterval(() => {
      this.outgoingEventBus.send({ kind: "HEARTBEAT" });
    }, 1000);

    // Create a new readable stream which is subscribed to events from this syncer.
    // Pipe it to the outgoing stream to the other peer.
    const outgoingStream = new ReadableStream({
      start(controller) {
        outgoingEventBus.on((event) => {
          if (event.kind === "CMD_FINISHED") {
            controller.close();
            return;
          }

          controller.enqueue(event);
        });
      },
    });

    outgoingStream.pipeTo(opts.partner.writable).catch(() => {
      // We'll abort the signal eventually, so we catch that here.
    });

    // Create a sink to handle incoming events, pipe the readable into that
    opts.partner.readable.pipeTo(this.incomingStreamCloner.writable).catch(
      (err) => {
        // HERE... websocket passing out
        this.cancel(err);
      },
    );

    const incomingClone = this.incomingStreamCloner.getReadableStream();

    incomingClone.pipeTo(
      new WritableStream({
        async write(event) {
          await handleIncomingEvent(event);
        },
      }),
    ).catch((err) => {
      this.cancel(err);
    });

    const incomingCloneForAgents = this.incomingStreamCloner
      .getReadableStream();

    // TODO: This cloner pipes all events, so if a replica is removed and re-added to a peer, it will get events intended for a previous sync agent. Which shouldn't be a problem, but it'd be better if it didn't.
    incomingCloneForAgents.pipeTo(this.agentStreamSplitter.writable).catch(
      (err) => {
        this.cancel(err);
      },
    );

    // Send off a salted handshake event
    const salt = randomId();
    Promise.all(
      this.peer.shares().map((ws) => saltAndHashShare(salt, ws)),
    ).then((saltedShares) => {
      outgoingEventBus.send({
        kind: "DISCLOSE",
        salt,
        syncerId: this.id,
        shares: saltedShares,
        formats: this.formats
          ? this.formats.map((f) => f.id)
          : [DEFAULT_FORMAT.id],
      });
    });

    this.transferManager.internallyMadeTransfersFinished().then(() => {
      this.outgoingEventBus.send({
        kind: "SYNCER_FULFILLED",
      });
    });

    this.partnerIsFulfilled.then(async () => {
      await this.transferManager.internallyMadeTransfersFinished();

      clearInterval(this.heartbeatInterval);
      this.outgoingEventBus.send({ kind: "CMD_FINISHED" });
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
    });

    agent.onStatusUpdate(() => {
      this.statusBus.send(this.getStatus());
    });

    this.syncAgents.set(address, agent);

    // Have to do this because we'll be using these values in a context where 'this' is different
    // (the streams below)
    const { outgoingEventBus } = this;

    // Pipe the agent's outgoing events into our event bus so they'll be sent out.
    agent.readable.pipeTo(
      new WritableStream({
        async write(event) {
          await outgoingEventBus.send({
            ...event,
            to: replica.share,
          });
        },
      }),
    ).then(() => {
      // Sticking a pin here 'cos it's handy.
      // The sync agent will finish here if in 'only_existing' mode.
    });

    const incomingFilteredEvents = this.agentStreamSplitter.getReadable(
      replica.share,
    );

    incomingFilteredEvents.pipeThrough(
      new TransformStream<SyncerEvent, SyncAgentEvent>({
        transform(event, controller) {
          switch (event.kind) {
            case "DISCLOSE":
            case "SYNCER_FULFILLED":
            case "HEARTBEAT":
              break;
            default: {
              if (event.to === replica.share) {
                const { to: _to, ...agentEvent } = event;
                controller.enqueue(agentEvent);
                break;
              }
            }
          }
        },
      }),
    ).pipeTo(agent.writable).catch((err) => {
      this.cancel(err);
    });

    this.transferManager.registerSyncAgent(agent);
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

        for (const share of commonShareSet) {
          this.addShare(share, intersectingFormats);
        }

        this.transferManager.registerOtherSyncerId(event.syncerId);
        this.transferManager.allSyncAgentsKnown();

        if (commonShareSet.size === 0 && this.mode === "once") {
          this.outgoingEventBus.send({
            "kind": "SYNCER_FULFILLED",
          });
        }

        break;
      }
      case "SYNCER_FULFILLED": {
        this.partnerIsFulfilled.resolve();
      }
    }
  }

  /** Get the status of all shares' syncing progress. */
  getStatus(): SyncerStatus {
    const status: SyncerStatus = {};

    for (const [shareAddr, agent] of this.syncAgents) {
      status[shareAddr] = {
        docs: agent.getStatus(),
        attachments: this.transferManager.getReports(shareAddr),
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
