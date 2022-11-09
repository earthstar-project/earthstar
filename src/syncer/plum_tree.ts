import {
  DocThumbnail,
  SyncAgentDocEvent,
  SyncAgentHaveEvent,
} from "./syncer_types.ts";
import { SyncAgent, SyncAgentGossiper } from "./sync_agent.ts";

/** A push-lazy-push-multicast tree, or 'PlumTree'. Organises a network of interconnected peers into a spanning tree where messaging resiliency, latency, and bandwidth are optimised.
 *
 * When Earthstar sync agents finish their initial reconciliation phase they are switched to a mode where they are managed by a plumtree.
 */
export class PlumTree {
  private messagingModes = new Map<
    string,
    "EAGER" | "LAZY"
  >();

  getMode(id: string): "EAGER" | "LAZY" {
    const maybeMode = this.messagingModes.get(id);

    if (maybeMode) {
      return maybeMode;
    }

    const initialMode = this.messagingModes.size === 0 ? "EAGER" : "LAZY";

    this.messagingModes.set(id, initialMode);

    return "EAGER";
  }

  /** A list of previously received message IDs, used to check incoming messages for duplicates.
   */
  private eagerMessageThumbnails = new Set<string>();

  /** A map of DocThumbnails to timers. */
  private haveTimeouts = new Map<DocThumbnail, number>();

  /** Triggered when the other peer sends a DOC message. Returns a boolean indicating whether to send a PRUNE event to the peer we got this message from. */
  onEagerMessage(id: string, event: SyncAgentDocEvent): boolean {
    // Check the list of have timers to see if we're waiting for this event.
    // If it's there, clear the timer.
    const maybeTimeout = this.haveTimeouts.get(event.thumbnail);

    if (maybeTimeout) {
      clearTimeout(maybeTimeout);
      // TODO: stop here?
      // return false
    }

    // Check the list of previously received eager messages for this ID.
    if (this.eagerMessageThumbnails.has(event.thumbnail)) {
      // If already present, switch to lazy messaging this peer.
      this.messagingModes.set(id, "LAZY");
      // ask syncagent to tell partner to make become lazy (PRUNE).
      return true;
    } else {
      // If not present, add to the list.
      this.eagerMessageThumbnails.add(event.thumbnail);
      return false;
    }
  }

  /** Triggered when the other peer sends a HAVE message */
  onLazyMessage(
    event: SyncAgentHaveEvent,
    dispatchGraft: (thumbnail: DocThumbnail) => void,
  ): void {
    // Set a timer for the this message to arrive.
    // (if a timer already exists, do nothing)
    if (!this.haveTimeouts.has(event.thumbnail)) {
      const timeout = setTimeout(() => {
        // When the timer expires, get the syncagent to send a WANT for this thumbnail.
        dispatchGraft(event.thumbnail);
      }, 100);
      // TODO: What should the timeout be?

      this.haveTimeouts.set(event.thumbnail, timeout);
    }
  }

  /** Triggered when the other peer sends a graft, i.e. WANT message. */
  onGraftMessage(id: string): void {
    // Move the peer who requested this to our eager peers.
    this.messagingModes.set(id, "EAGER");
  }

  /** Triggered when the other peer sends a PRUNE message. */
  onPrune(id: string): void {
    this.messagingModes.set(id, "LAZY");
  }
}

// We have to store a bit of plumtree info the messaging mode - in the sync agent. right?
