import { deferred } from "https://deno.land/std@0.138.0/async/deferred.ts";
import { Crypto } from "../crypto/crypto.ts";
import {
  DefaultFormat,
  FormatsArg,
  getFormatIntersection,
} from "../formats/default.ts";
import { IPeer } from "../peer/peer-types.ts";
import {
  BlockingBus,
  CloneStream,
  StreamSplitter,
} from "../streams/stream_utils.ts";
import { ShareAddress } from "../util/doc-types.ts";
import { randomId } from "../util/misc.ts";
import {
  SyncAgentEvent,
  SyncAgentStatus,
  SyncerEvent,
  SyncerMode,
  SyncerOpts,
  SyncerStatus,
} from "./syncer_types.ts";
import { SyncAgent } from "./sync_agent.ts";

/** Syncs the contents of a Peer's replicas with that of another peer's.  */
export class Syncer<F> {
  private peer: IPeer;
  private outgoingEventBus = new BlockingBus<SyncerEvent>();
  private syncAgents = new Map<ShareAddress, SyncAgent<F>>();
  private mode: SyncerMode;
  private incomingStreamCloner = new CloneStream<SyncerEvent>();
  private statusBus = new BlockingBus<SyncerStatus>();
  private agentStreamSplitter = new StreamSplitter<SyncerEvent>((chunk) => {
    if (chunk.kind === "DISCLOSE") {
      return;
    }

    return chunk.to;
  });
  private formats: FormatsArg<F> | undefined;

  isDone = deferred<true>();

  constructor(opts: SyncerOpts<F>) {
    // Have to do this because we'll be using these values in a context where 'this' is different
    // (the streams below)
    const { outgoingEventBus } = this;
    const handleIncomingEvent = this.handleIncomingEvent.bind(this);

    this.peer = opts.peer;
    this.mode = opts.mode;
    this.formats = opts.formats;

    // Create a new readable stream which is subscribed to events from this syncer.
    // Pipe it to the outgoing stream to the other peer.
    const outgoingStream = new ReadableStream({
      start(controller) {
        outgoingEventBus.on((event) => {
          controller.enqueue(event);

          // TODO: close when a certain event comes through
        });
      },
    });

    const abortController = new AbortController();

    outgoingStream.pipeTo(opts.partner.writable, {
      signal: abortController.signal,
    }).catch(() => {
      // We catch aborting the signal here.
    });

    // Create a sink to handle incoming events, pipe the readable into that
    opts.partner.readable.pipeTo(this.incomingStreamCloner.writable);

    const incomingClone = this.incomingStreamCloner.getReadableStream();

    incomingClone.pipeTo(
      new WritableStream({
        async write(event) {
          await handleIncomingEvent(event);
        },
      }),
    );

    const incomingCloneForAgents = this.incomingStreamCloner
      .getReadableStream();

    // TODO: This cloner pipes all events, so if a replica is removed and re-added to a peer, it will get events intended for a previous sync agent. Which shouldn't be a problem, but it'd be better if it didn't.
    incomingCloneForAgents.pipeTo(this.agentStreamSplitter.writable);

    // Send off a salted handshake event
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

    // If the syncer is in done mode, it should abort its outgoing stream when all sync agents are done.
    this.statusBus.on((status) => {
      if (this.mode === "live") {
        return;
      }

      const statuses: string[] = [];

      for (const addr in status) {
        statuses.push(status[addr].status);
      }

      if (statuses.every((status) => status === "done")) {
        this.isDone.resolve(true);
        abortController.abort();
      }
    });

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

  private addShare<K>(address: string, formats: FormatsArg<K>) {
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
    ).pipeTo(agent.writable);
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
      }
    }
  }

  /** Get the status of all shares' syncing progress. */
  getStatus() {
    const status: Record<ShareAddress, SyncAgentStatus> = {};

    for (const [shareAddr, agent] of this.syncAgents) {
      status[shareAddr] = agent.getStatus();
    }

    return status;
  }

  /** Fires the provided callback whenever any shares' syncing progress changes. */
  onStatusChange(callback: (status: SyncerStatus) => void): () => void {
    return this.statusBus.on(callback);
  }

  /** Stop syncing. */
  cancel() {
    for (const [_addr, agent] of this.syncAgents) {
      agent.cancel();
    }
  }
}

function saltAndHashShare(
  salt: string,
  share: ShareAddress,
): Promise<string> {
  return Crypto.sha256base32(salt + share + salt);
}
