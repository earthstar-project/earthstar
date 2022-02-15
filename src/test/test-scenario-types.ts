import { Peer } from "../peer/peer.ts";
import { WorkspaceAddress } from "../util/doc-types.ts";
import { ICryptoDriver } from "../crypto/crypto-types.ts";
import { IStorageAsync, IStorageDriverAsync } from "../storage/storage-types.ts";
import { SyncerBag } from "../syncer/_syncer-bag.ts";
import { Rpc } from "./test-deps.ts";

export interface TestScenario {
    // name of test, to show in list of tests
    name: string;

    // which crypto driver to use
    cryptoDriver: ICryptoDriver;

    // is this storage scenario expected to persist (to disk, etc)?
    persistent: boolean;

    // in here you will instantiate a StorageDriver and then
    // use it to instantiate a Storage:
    makeDriver: (ws: WorkspaceAddress) => IStorageDriverAsync;

    // Config keys that come with the driver
    builtInConfigKeys: string[];
}

export interface CryptoScenario {
    name: string;
    driver: ICryptoDriver;
}

export interface TransportTestHelper {
    name: string;
    clientPeer: Peer;
    targetPeer: Peer;
    clientTransport: Rpc.ITransport<SyncerBag>;
    targetTransport: Rpc.ITransport<SyncerBag>;
    connect: () => Promise<void>;
    teardown: () => Promise<void>;
}

export interface TransportScenario {
    name: string;
    make: (peer: Peer, targetPeer: Peer) => TransportTestHelper;
}

export type Syncable = Peer | string;

export interface PeerSyncHelper {
    name: string;
    setUpTargetPeers(
        aStorages: IStorageAsync[],
        bStorages: IStorageAsync[],
        cStorages: IStorageAsync[],
    ): Promise<Syncable[]>;
    addNonSyncingStorages(
        dStorages: IStorageAsync[],
    ): void;
    close(): Promise<void>;
}

export interface PeerSyncScenario {
    name: string;
    make: () => PeerSyncHelper;
}
