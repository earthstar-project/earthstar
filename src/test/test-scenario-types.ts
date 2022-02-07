import { Peer } from "../peer/peer.ts";
import { WorkspaceAddress } from "../util/doc-types.ts";
import { ICryptoDriver } from "../crypto/crypto-types.ts";
import { IStorageDriverAsync } from "../storage/storage-types.ts";
import { SyncerBag } from "../syncer/_syncer-bag.ts";
import { Rpc } from "../../deps.ts";

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
}

export interface CryptoScenario {
    name: string;
    driver: ICryptoDriver;
}

export interface TransportScenario {
    name: string;
    clientPeer: Peer;
    targetPeer: Peer;
    clientTransport: Rpc.ITransport<SyncerBag>;
    targetTransport: Rpc.ITransport<SyncerBag>;
    connect: () => Promise<void>;
    teardown: () => Promise<void>;
}
