import { TransportScenario, TransportTestHelper } from "../test-scenario-types.ts";
import { Peer } from "../../peer/peer.ts";
import { Rpc } from "../../../deps.ts";
import { makeSyncerBag, SyncerBag } from "../../syncer/_syncer-bag.ts";

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

export const transportScenarioLocal: TransportScenario = {
    name: "TransportLocal",
    make: function (peer: Peer, targetPeer: Peer): TransportTestHelper {
        return new TransportHelperLocal(peer, targetPeer);
    },
};
