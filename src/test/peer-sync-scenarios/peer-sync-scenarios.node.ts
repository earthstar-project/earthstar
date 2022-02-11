import { Peer } from "../../peer/peer.ts";
import { StorageAsync } from "../../storage/storage-async.ts";
import { sleep } from "../../util/misc.ts";
import { makeSyncerBag, SyncerBag } from "../../syncer/_syncer-bag.ts";
import { Syncer } from "../../syncer/syncer.ts";
import { PeerSyncHelper } from "../test-scenario-types.ts";
import { default as express, Express } from "https://esm.sh/express?dts";
import { TransportHttpServerExpress } from "https://esm.sh/earthstar-streaming-rpc@3.0.0?dts";

import universalSyncScenarios from "./peer-sync-scenarios.universal.ts";

class HttpPeerScenario implements PeerSyncHelper {
    name = "Peers over HTTP";

    _peer2 = new Peer();
    _transport2: TransportHttpServerExpress<SyncerBag>;
    _app2: Express;
    _server2: ReturnType<Express["listen"]> | null = null;
    _syncer2: Syncer<TransportHttpServerExpress<SyncerBag>>;

    _peer3 = new Peer();
    _transport3: TransportHttpServerExpress<SyncerBag>;
    _app3: Express;
    _server3: ReturnType<Express["listen"]> | null = null;
    _syncer3: Syncer<TransportHttpServerExpress<SyncerBag>>;

    constructor() {
        // Set up server
        this._app2 = express();

        // Set up server
        this._app3 = express();

        this._transport2 = new TransportHttpServerExpress({
            app: this._app2,
            deviceId: this._peer2.peerId,
            methods: makeSyncerBag(this._peer2),
        });

        this._transport3 = new TransportHttpServerExpress({
            app: this._app3,
            deviceId: this._peer3.peerId,
            methods: makeSyncerBag(this._peer3),
        });

        this._syncer2 = new Syncer(this._peer2, () => this._transport2);
        this._syncer3 = new Syncer(this._peer3, () => this._transport3);
    }

    setUpTargetPeers(
        aStorages: StorageAsync[],
        bStorages: StorageAsync[],
        cStorages: StorageAsync[],
    ) {
        const [, storageA2, storageA3] = aStorages;
        const [, storageB2, storageB3] = bStorages;
        const [, storageC2, storageC3] = cStorages;

        this._peer2.addStorage(storageA2);
        this._peer2.addStorage(storageB2);
        this._peer2.addStorage(storageC2);

        this._peer3.addStorage(storageA3);
        this._peer3.addStorage(storageB3);
        this._peer3.addStorage(storageC3);

        this._server2 = this._app2.listen(9091);
        this._server3 = this._app3.listen(9092);

        return Promise.resolve(["http://localhost:9091", "http://localhost:9092"]);
    }

    addNonSyncingStorages(
        dStorages: StorageAsync[],
    ) {
        const [, storageD2, storageD3] = dStorages;
        this._peer2.addStorage(storageD2);
        this._peer3.addStorage(storageD3);
    }

    async close() {
        const removers2 = this._peer2.storages().map((storage) =>
            () => {
                this._peer2.removeStorage(storage);
            }
        );
        const removers3 = this._peer3.storages().map((storage) =>
            () => {
                this._peer3.removeStorage(storage);
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
