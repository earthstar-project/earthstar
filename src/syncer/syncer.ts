// Syncer.

import { Crypto } from "../crypto/crypto.ts";
import { IPeer } from "../peer/peer-types.ts";
import { BlockingBus, CloneStream } from "../streams/stream_utils.ts";
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

// TODO: Handle peer replicas being added / removed.

export class Syncer {
  private peer: IPeer;
  private outgoingEventBus = new BlockingBus<SyncerEvent>();
  private syncAgents = new Map<ShareAddress, SyncAgent>();
  private mode: SyncerMode;
  private incomingStreamCloner = new CloneStream<SyncerEvent>();
  private statusBus = new BlockingBus<SyncerStatus>();

  constructor(opts: SyncerOpts) {
    // Have to do this because we'll be using these values in a context where 'this' is different
    // (the streams below)
    const { outgoingEventBus } = this;
    const handleIncomingEvent = this.handleIncomingEvent.bind(this);

    this.peer = opts.peer;
    this.mode = opts.mode;

    // Create a new readable stream which is subscribed to events from this syncer.
    // Pipe it to the outgoing stream to the other peer.
    new ReadableStream({
      start(controller) {
        outgoingEventBus.on((event) => {
          controller.enqueue(event);

          // TODO: close when a certain event comes through
        });
      },
    }).pipeTo(opts.driver.writable);

    // Create a sink to handle incoming events, pipe the readable into that
    opts.driver.readable.pipeTo(this.incomingStreamCloner.writable);

    const incomingClone = this.incomingStreamCloner.getReadableStream();

    incomingClone.pipeTo(
      new WritableStream({
        async write(event) {
          await handleIncomingEvent(event);
        },
      }),
    );

    // Send off a salted handshake event
    const salt = randomId();
    Promise.all(
      this.peer.shares().map((ws) => saltAndHashShare(salt, ws)),
    ).then((saltedShares) => {
      outgoingEventBus.send({
        kind: "DISCLOSE",
        salt,
        shares: saltedShares,
      });
    });
  }

  private addShare(address: string) {
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
    );

    // Get a clone of the incoming event stream.
    const incomingClone = this.incomingStreamCloner.getReadableStream();

    // Filter it for events relevant to this agent
    incomingClone.pipeThrough(
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
          this.addShare(share);
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
}

function saltAndHashShare(
  salt: string,
  share: ShareAddress,
): Promise<string> {
  return Crypto.sha256base32(salt + share + salt);
}
