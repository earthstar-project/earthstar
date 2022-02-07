import { Peer } from "../peer/peer.ts";
import { PeerId } from "../peer/peer-types.ts";
import { makeSyncerBag, SyncerBag } from "./_syncer-bag.ts";
import { Rpc } from "../../deps.ts";
import { SyncCoordinator } from "./sync-coordinator.ts";

/** A generic syncer which can be used with any kind of Transport.
 */
export class Syncer<TransportType extends Rpc.ITransport<SyncerBag>> {
    /** The transport used by the syncer. Can be used to add new connections. */
    transport: TransportType;
    _coordinators: Map<PeerId, SyncCoordinator> = new Map();
    _peer: Peer;

    /**
     * Instantiate a new Syncer
     * @param peer - The peer to be synchronised
     * @param makeTransport - A factory which returns a specific Transport. The first parameter of this function are the methods to be passed to the transport's options.
     */
    constructor(peer: Peer, makeTransport: (methods: SyncerBag) => TransportType) {
        this._peer = peer;

        this.transport = makeTransport(makeSyncerBag(peer));

        this.transport.connections.onAdd((connection) => {
            const coordinator = new SyncCoordinator(this._peer, connection);
            this._coordinators.set(connection._deviceId, coordinator);
            coordinator.start();
        });

        this.transport.connections.onDelete((connection) => {
            const coordinator = this._coordinators.get(connection.description);

            if (coordinator) {
                coordinator.close();
            }

            this._coordinators.delete(connection.description);
        });
    }

    /** Close the syncer's transport and all synchronisations. */
    close() {
        this._coordinators.forEach((coordinator) => {
            coordinator.close();
        });

        this._coordinators.clear();

        this.transport.close();
    }
}
