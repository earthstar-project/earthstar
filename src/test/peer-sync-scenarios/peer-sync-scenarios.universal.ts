import { Peer } from "../../peer/peer.ts";
import { Replica } from "../../replica/replica.ts";
import { PeerSyncHelper } from "../test-scenario-types.ts";

export class LocalPeerScenario implements PeerSyncHelper {
  name = "Local peers";
  _peer2 = new Peer();
  _peer3 = new Peer();
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

    return Promise.resolve([this._peer2, this._peer3]);
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
  }
}

export default [{ name: "Local Peers", make: () => new LocalPeerScenario() }];
