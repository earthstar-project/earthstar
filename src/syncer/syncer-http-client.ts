import { Peer } from "../peer/peer.ts";
import { PeerId } from "../peer/peer-types.ts";
import { makeSyncerBag, SyncerBag } from "./_syncer-bag.ts";
import { TransportHttpClient } from "../../deps.ts";
import { SyncCoordinator } from "./sync-coordinator.ts";

/** A syncer for remote peers which are HTTP servers */
export class SyncerHttpClient {
    _transport: TransportHttpClient<SyncerBag>;
    _coordinators: Map<PeerId, SyncCoordinator> = new Map();

    _peer: Peer;

    constructor(peer: Peer) {
        this._peer = peer;

        const httpClientTransport = new TransportHttpClient({
            deviceId: peer.peerId,
            methods: makeSyncerBag(peer),
        });

        this._transport = httpClientTransport;
    }

    /** Begin synchronisation with a HTTP server */
    async addServer(
        url: string,
    ) {
        const connection = this._transport.addConnection(url);

        const coordinator = new SyncCoordinator(this._peer, connection);

        await coordinator.start();

        this._coordinators.set(`${coordinator.partnerPeerId}`, coordinator);

        return connection;
    }

    close() {
        this._transport.close();

        this._coordinators.forEach((coordinator) => {
            coordinator.close();
        });
    }
}
