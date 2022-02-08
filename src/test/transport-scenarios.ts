import { TransportScenario, TransportTestHelper } from "./test-scenario-types.ts";
import { Peer } from "../peer/peer.ts";
import { Rpc } from "../../deps.ts";
import { makeSyncerBag, SyncerBag } from "../syncer/_syncer-bag.ts";
import { serve } from "https://deno.land/std@0.123.0/http/server.ts";
import { Opine, opine } from "https://deno.land/x/opine@2.1.1/mod.ts";
import { sleep } from "../util/misc.ts";

class TransportHelperLocal implements TransportTestHelper {
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

class TransportHelperHttp implements TransportTestHelper {
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

        // Set up server
        this.targetTransport = new Rpc.TransportHttpServer({
            deviceId: targetPeer.peerId,
            methods: makeSyncerBag(targetPeer),
        });

        this._controller = new AbortController();

        this._serverPromise = serve(
            this.targetTransport.handler,
            { hostname: "0.0.0.0", port: 1234, signal: this._controller.signal },
        );

        // Set up client
        this.clientTransport = new Rpc.TransportHttpClient({
            deviceId: peer.peerId,
            methods: makeSyncerBag(peer),
        });
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

class TransportHelperHttpOpine implements TransportTestHelper {
    name = "TransportHttpClient + TransportHttpServerOpine";
    clientPeer: Peer;
    targetPeer: Peer;
    clientTransport: Rpc.TransportHttpClient<SyncerBag>;
    targetTransport: Rpc.TransportHttpServerOpine<SyncerBag>;
    _controller: AbortController;
    _server: ReturnType<Opine["listen"]>;

    constructor(peer: Peer, targetPeer: Peer) {
        this.clientPeer = peer;
        this.targetPeer = targetPeer;

        // Set up server
        const app = opine();

        this.targetTransport = new Rpc.TransportHttpServerOpine({
            app,
            deviceId: targetPeer.peerId,
            methods: makeSyncerBag(targetPeer),
        });

        this._controller = new AbortController();

        this._server = app.listen(2345);

        // Set up client
        this.clientTransport = new Rpc.TransportHttpClient({
            deviceId: peer.peerId,
            methods: makeSyncerBag(peer),
        });
    }

    connect() {
        this.clientTransport.addConnection("http://localhost:2345");

        return Promise.resolve();
    }

    teardown() {
        this.clientTransport.close();
        this.targetTransport.close();

        this._controller.abort("End of test");

        this._server.close();

        return sleep(10);
    }
}

export const transportScenarioLocal: TransportScenario = {
    name: "TransportLocal",
    make: function (peer: Peer, targetPeer: Peer): TransportTestHelper {
        return new TransportHelperLocal(peer, targetPeer);
    },
};

export const transportScenarioHttp: TransportScenario = {
    name: "TransportHttpClient + TransportHttpServer",
    make: function (peer: Peer, targetPeer: Peer): TransportTestHelper {
        return new TransportHelperHttp(peer, targetPeer);
    },
};

export const transportScenarioHttpOpine: TransportScenario = {
    name: "TransportHttpClient + TransportHttpServerOpine",
    make: function (peer: Peer, targetPeer: Peer): TransportTestHelper {
        return new TransportHelperHttpOpine(peer, targetPeer);
    },
};
