import { Peer } from "../../peer/peer.ts";
import { StorageAsync } from "../../storage/storage-async.ts";
import { PeerSyncHelper } from "../test-scenario-types.ts";

export class LocalPeerScenario implements PeerSyncHelper {
    name = "Local peers";
    _peer2 = new Peer();
    _peer3 = new Peer();
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

        return Promise.resolve([this._peer2, this._peer3]);
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
    }
}

export default [{ name: "Local Peers", make: () => new LocalPeerScenario() }];
