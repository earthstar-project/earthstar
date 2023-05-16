import { IPeer } from "../peer/peer-types.ts";
import { Syncer } from "../syncer/syncer.ts";
import { SyncAppetite } from "../syncer/syncer_types.ts";

/** A service which discovers other remote or local Earthstar peers. */
export interface DiscoveryService {
  events: AsyncIterable<DiscoveryServiceEvent>;
  /** Stop the discovery service from finding other peers and advertising itself. */
  stop(): void;
}

export type DiscoveryServiceEvent =
  | {
    kind: "PEER_DISCOVERED";
    /** The description of the peer */
    description: string;
    /** A callback which starts a new sync session and returns the resulting `Syncer`. */
    begin: (
      peer: IPeer,
      appetite: SyncAppetite,
    ) => Promise<Syncer<unknown, unknown>>;
  }
  | {
    kind: "PEER_INITIATED_SYNC";
    /** The description of the peer */
    description: string;
    /** A callback which begins the incoming sync session and returns the resulting `Syncer`. */
    begin: (
      peer: IPeer,
    ) => Promise<Syncer<unknown, unknown>>;
  }
  | {
    kind: "PEER_EXITED";
    /** The description of the peer */
    description: string;
  }
  /** For when the service has halted. Used to break the async iterable. */
  | {
    kind: "SERVICE_STOPPED";
  };

/** A discovery service event, indicating:
 *
 * - That a new peer has been discovered
 * - That another peer discovered us and initiated sync
 * - That a peer which had been previously discovered has exited.
 */
export type DiscoveryEvent =
  /** An event indicating a peer has been discovered by the service. */
  | {
    kind: "PEER_DISCOVERED";
    /** The description of the peer */
    description: string;
    /** A callback to initiate sync with this peer. */
    sync: (
      opts?: { syncContinuously: boolean },
    ) => Promise<Syncer<unknown, unknown>>;
  }
  /** An event indicating another peer has discovered us and initiated sync. */
  | {
    kind: "PEER_INITIATED_SYNC";
    /** The description of the peer */
    description: string;
    /** The `Syncer` created for this sync session. */
    syncer: Syncer<unknown, unknown>;
  }
  /** A peer which had previously been discovered has exited. */
  | {
    kind: "PEER_EXITED";
    /** The description of the peer */
    description: string;
  };
