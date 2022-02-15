import { Peer } from "../../peer/peer.ts";
import { Replica } from "../../replica/replica.ts";
import { sleep } from "../../util/misc.ts";
import { makeSyncerBag, SyncerBag } from "../../syncer/_syncer-bag.ts";
import { Syncer } from "../../syncer/syncer.ts";
import { PeerSyncHelper } from "../test-scenario-types.ts";
import { default as express, Express } from "https://esm.sh/express?dts";
import { Rpc } from "../test-deps.node.ts";

import universalSyncScenarios from "./peer-sync-scenarios.universal.ts";

class HttpPeerScenario implements PeerSyncHelper {
    name = "Peers over HTTP";

    _peer2 = new Peer();
    _transport2: Rpc.TransportHttpServerExpress<SyncerBag>;
    _app2: Express;
    _server2: ReturnType<Express["listen"]> | null = null;
    _syncer2: Syncer<Rpc.TransportHttpServerExpress<SyncerBag>>;

    _peer3 = new Peer();
    _transport3: Rpc.TransportHttpServerExpress<SyncerBag>;
    _app3: Express;
    _server3: ReturnType<Express["listen"]> | null = null;
    _syncer3: Syncer<Rpc.TransportHttpServerExpress<SyncerBag>>;

    constructor() {
        // Set up server
        this._app2 = express();

        // Set up server
        this._app3 = express();

        this._transport2 = new Rpc.TransportHttpServerExpress({
            app: this._app2,
            deviceId: this._peer2.peerId,
            methods: makeSyncerBag(this._peer2),
        });

        this._transport3 = new Rpc.TransportHttpServerExpress({
            app: this._app3,
            deviceId: this._peer3.peerId,
            methods: makeSyncerBag(this._peer3),
        });

        this._syncer2 = new Syncer(this._peer2, () => this._transport2);
        this._syncer3 = new Syncer(this._peer3, () => this._transport3);
    }

    setUpTargetPeers(
        aStorages: Replica[],
        bStorages: Replica[],
        cStorages: Replica[],
    ) {
        const [, storageA2, storageA3] = aStorages;
        const [, storageB2, storageB3] = bStorages;
        const [, storageC2, storageC3] = cStorages;

        this._peer2.addReplica(storageA2);
        this._peer2.addReplica(storageB2);
        this._peer2.addReplica(storageC2);

        this._peer3.addReplica(storageA3);
        this._peer3.addReplica(storageB3);
        this._peer3.addReplica(storageC3);

        this._server2 = this._app2.listen(9091);
        this._server3 = this._app3.listen(9092);

        return Promise.resolve(["http://localhost:9091", "http://localhost:9092"]);
    }

    addNonSyncingStorages(
        dStorages: Replica[],
    ) {
        const [, storageD2, storageD3] = dStorages;
        this._peer2.addReplica(storageD2);
        this._peer3.addReplica(storageD3);
    }

    async close() {
        const removers2 = this._peer2.replicas().map((replica) =>
            () => {
                this._peer2.removeReplica(replica);
            }
        );
        const removers3 = this._peer3.replicas().map((replica) =>
            () => {
                this._peer3.removeReplica(replica);
            }
        );

        await Promise.all([...removers2, ...removers3]);

        this._syncer2.close();
        this._syncer3.close();

        this._server2?.close();
        this._server3?.close();

        return sleep(500);
    }
}

export default [...universalSyncScenarios, {
    name: "HTTP Peers (with Express server)",
    make: () => new HttpPeerScenario(),
}];
