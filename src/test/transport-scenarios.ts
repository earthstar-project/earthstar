import { TransportScenario } from "./test-scenario-types.ts";
import { Peer } from "../peer/peer.ts";
import { Rpc } from "../../deps.ts";
import { makeSyncerBag, SyncerBag } from "../syncer/_syncer-bag.ts";
import { serve } from "https://deno.land/std@0.123.0/http/server.ts";
import { sleep } from "../util/misc.ts";

class TransportScenarioLocal implements TransportScenario {
    name = "TransportLocal";
    clientPeer: Peer;
    targetPeer: Peer;
    clientTransport: Rpc.TransportLocal<SyncerBag>;
    targetTransport: Rpc.TransportLocal<SyncerBag>;

    constructor(peer: Peer, targetPeer: Peer) {
        this.clientPeer = peer;
        this.targetPeer = targetPeer;

        this.clientTransport = new Rpc.TransportLocal({
            deviceId: peer.peerId,
            description: `Local:${peer.peerId}`,
            methods: makeSyncerBag(peer),
        });

        this.targetTransport = new Rpc.TransportLocal({
            deviceId: peer.peerId,
            description: `Local:${targetPeer.peerId}`,
            methods: makeSyncerBag(targetPeer),
        });
    }

    connect() {
        this.clientTransport.addConnection(this.targetTransport);

        return Promise.resolve();
    }

    teardown() {
        this.clientTransport.close();
        this.targetTransport.close();

        return Promise.resolve();
    }
}

class TransportScenarioHttp implements TransportScenario {
    name = "TransportHttpClient + TransportHttpServer";
    clientPeer: Peer;
    targetPeer: Peer;
    clientTransport: Rpc.TransportHttpClient<SyncerBag>;
    targetTransport: Rpc.TransportHttpServer<SyncerBag>;
    _controller: AbortController;
    _serverPromise: Promise<void>;

    constructor(peer: Peer, targetPeer: Peer) {
        this.clientPeer = peer;
        this.targetPeer = targetPeer;

        this.clientTransport = new Rpc.TransportHttpClient({
            deviceId: peer.peerId,
            methods: makeSyncerBag(peer),
        });

        this.targetTransport = new Rpc.TransportHttpServer({
            deviceId: targetPeer.peerId,
            methods: makeSyncerBag(targetPeer),
        });

        this._controller = new AbortController();

        this._serverPromise = serve(
            this.targetTransport.handler,
            { hostname: "0.0.0.0", port: 1234, signal: this._controller.signal },
        );
    }

    connect() {
        this.clientTransport.addConnection("http://localhost:1234");

        return Promise.resolve();
    }

    teardown() {
        this.clientTransport.close();
        this.targetTransport.close();

        this._controller.abort("End of test");

        return this._serverPromise;
    }
}

// Stupid things I need to do to keep Typescript happy.

export function makeTransportScenarioLocal(peer: Peer, targetPeer: Peer): TransportScenario {
    return new TransportScenarioLocal(peer, targetPeer);
}

export function makeTransportScenarioHttp(peer: Peer, targetPeer: Peer): TransportScenario {
    return new TransportScenarioHttp(peer, targetPeer);
}
