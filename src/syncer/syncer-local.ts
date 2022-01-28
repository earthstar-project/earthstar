import { TransportLocal } from "../../deps.ts";
import { Peer } from "../peer/peer.ts";
import { PeerId } from "../peer/peer-types.ts";
import { makeSyncerBag, SyncerBag } from "./_syncer-bag.ts";
import { SyncCoordinator } from "./sync-coordinator.ts";

/** A syncer for peers existing on the same device */
export class SyncerLocal {
    _transport: TransportLocal<SyncerBag>;
    _coordinators: Map<PeerId, SyncCoordinator> = new Map();
    _peer: Peer;

    constructor(peer: Peer) {
        this._peer = peer;

        const localTransport = new TransportLocal({
            deviceId: peer.peerId,
            description: `Local:${peer.peerId}`,
            methods: makeSyncerBag(peer),
        });

        this._transport = localTransport;
    }

    async addPeer(
        targetPeer: Peer,
    ): Promise<{ coordinator: SyncCoordinator; otherCoordinator: SyncCoordinator }> {
        const targetTransport = new TransportLocal({
            deviceId: targetPeer.peerId,
            description: `Local:${targetPeer.peerId}`,
            methods: makeSyncerBag(targetPeer),
        });

        const { thisConn, otherConn } = this._transport.addConnection(targetTransport);

        const coordinator = new SyncCoordinator(this._peer, thisConn);
        const otherCoordinator = new SyncCoordinator(targetPeer, otherConn);

        this._coordinators.set(targetPeer.peerId, coordinator);

        await coordinator.start();
        await otherCoordinator.start();

        return { coordinator, otherCoordinator };
    }

    close() {
        this._coordinators.forEach((coordinator) => {
            coordinator.close();
        });
    }
}
