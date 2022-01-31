import { Peer } from "../peer/peer.ts";
import { PeerId } from "../peer/peer-types.ts";
import { makeSyncerBag, SyncerBag } from "./_syncer-bag.ts";
import { TransportHttpHandler } from "../../deps.ts";
import { SyncCoordinator } from "./sync-coordinator.ts";

/** A syncer for remote peers which are HTTP clients.
 * Upon initilisation, use the `handler` property with your HTTP server of choice.
 */
export class SyncerHttpHandler {
    _transport: TransportHttpHandler<SyncerBag>;
    _coordinators: Map<PeerId, SyncCoordinator> = new Map();
    _peer: Peer;

    handler: (req: Request) => Promise<Response>;

    constructor(peer: Peer, path: string) {
        this._peer = peer;

        const httpHandlerTransport = new TransportHttpHandler({
            deviceId: peer.peerId,
            methods: makeSyncerBag(peer),
            path,
        });

        this._transport = httpHandlerTransport;
        this.handler = httpHandlerTransport.handler;

        httpHandlerTransport.connections.onAdd(async (connection) => {
            const coordinator = new SyncCoordinator(this._peer, connection);
            await coordinator.start();
            this._coordinators.set(`${connection._deviceId}`, coordinator);
        });
    }

    close() {
        this._transport.close();

        this._coordinators.forEach((coordinator) => {
            coordinator.close();
        });
    }
}
