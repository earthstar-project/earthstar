import { TransportScenario, TransportTestHelper } from "../test-scenario-types.ts";
import { Peer } from "../../peer/peer.ts";
import { makeSyncerBag, SyncerBag } from "../../syncer/_syncer-bag.ts";
import { sleep } from "../../util/misc.ts";
import { default as express, Express } from "https://esm.sh/express?dts";
import { Rpc } from "../test-deps.node.ts";
import { transportScenarioLocal } from "./transport-scenarios.universal.ts";

class TransportHelperHttpExpress implements TransportTestHelper {
    name = "TransportHttpClient + TransportHttpServerExpress";
    clientPeer: Peer;
    targetPeer: Peer;
    clientTransport: Rpc.TransportHttpClient<SyncerBag>;
    targetTransport: Rpc.TransportHttpServerExpress<SyncerBag>;

    _server: ReturnType<Express["listen"]>;

    constructor(peer: Peer, targetPeer: Peer) {
        this.clientPeer = peer;
        this.targetPeer = targetPeer;

        // Set up server
        const app = express();

        this.targetTransport = new Rpc.TransportHttpServerExpress({
            app,
            deviceId: targetPeer.peerId,
            methods: makeSyncerBag(targetPeer),
        });

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

        this._server.close();

        return sleep(500);
    }
}

const transportScenarioHttpExpress: TransportScenario = {
    name: "TransportHttpClient + TransportHttpServerExpress",
    make: function (peer: Peer, targetPeer: Peer): TransportTestHelper {
        return new TransportHelperHttpExpress(peer, targetPeer);
    },
};

export default [transportScenarioLocal, transportScenarioHttpExpress];
