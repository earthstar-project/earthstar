import { Peer } from "../peer/peer.ts";
import { PeerId } from "../peer/peer-types.ts";
import { makeSyncerBag, SyncerBag } from "./_syncer-bag.ts";
import { type ITransport, SuperbusMap } from "../../deps.ts";
import { SyncCoordinator } from "./sync-coordinator.ts";
import { ISyncer, SyncSessionStatus } from "./syncer-types.ts";
import { ShareAddress } from "../util/doc-types.ts";

/** A generic syncer which can be used with any kind of Transport.
 */
export class Syncer<TransportType extends ITransport<SyncerBag>>
  implements ISyncer<TransportType> {
  /** The transport used by the syncer. Can be used to add new connections. */
  transport: TransportType;
  private coordinators: Map<PeerId, SyncCoordinator> = new Map();
  private peer: Peer;

  /** A subscribable map containing the syncer's connections' sync statuses. */
  syncStatuses: SuperbusMap<
    string,
    Record<ShareAddress, SyncSessionStatus>
  > = new SuperbusMap();

  /**
   * Instantiate a new Syncer
   * @param peer - The peer to be synchronised
   * @param makeTransport - A factory which returns a specific Transport. The first parameter of this function are the methods to be passed to the transport's options.
   */
  constructor(
    peer: Peer,
    makeTransport: (methods: SyncerBag) => TransportType,
  ) {
    this.peer = peer;

    this.transport = makeTransport(makeSyncerBag(peer));

    this.transport.connections.onAdd((connection) => {
      const coordinator = new SyncCoordinator(this.peer, connection);
      this.coordinators.set(connection.description, coordinator);
      coordinator.start();

      coordinator.syncStatuses.bus.on("*", () => {
        const syncStatuses: Record<ShareAddress, SyncSessionStatus> = {};

        for (const [share, status] of coordinator.syncStatuses.entries()) {
          syncStatuses[share] = status;
        }

        this.syncStatuses.set(connection.description, syncStatuses);
      });
    });

    this.transport.connections.onDelete((connection) => {
      const coordinator = this.coordinators.get(connection.description);

      if (coordinator) {
        coordinator.close();
      }

      this.syncStatuses.delete(connection.description);

      this.coordinators.delete(connection.description);
    });
  }

  /** Close the syncer's transport and all synchronisations. */
  close() {
    this.coordinators.forEach((coordinator) => {
      coordinator.close();
    });

    this.coordinators.clear();

    this.transport.close();
  }
}
