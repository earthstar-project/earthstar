import { Peer } from "../../peer/peer.ts";
import { Replica } from "../../replica/replica.ts";
import { Rpc, serve } from "../test-deps.ts";
import { makeSyncerBag, SyncerBag } from "../../syncer/_syncer-bag.ts";
import { Syncer } from "../../syncer/syncer.ts";
import { PeerSyncHelper } from "../test-scenario-types.ts";

import universalSyncScenarios from "./peer-sync-scenarios.universal.ts";

class HttpPeerScenario implements PeerSyncHelper {
  name = "Peers over HTTP";
  _peer2 = new Peer();
  _transport2: Rpc.TransportHttpServer<SyncerBag>;
  _controller2: AbortController;
  _serverPromise2: Promise<void> | null = null;
  _syncer2: Syncer<Rpc.TransportHttpServer<SyncerBag>>;

  _peer3 = new Peer();
  _transport3: Rpc.TransportHttpServer<SyncerBag>;
  _controller3: AbortController;
  _serverPromise3: Promise<void> | null = null;
  _syncer3: Syncer<Rpc.TransportHttpServer<SyncerBag>>;

  constructor() {
    this._transport2 = new Rpc.TransportHttpServer({
      deviceId: this._peer2.peerId,
      methods: makeSyncerBag(this._peer2),
    });

    this._transport3 = new Rpc.TransportHttpServer({
      deviceId: this._peer3.peerId,
      methods: makeSyncerBag(this._peer3),
    });

    this._controller2 = new AbortController();
    this._controller3 = new AbortController();

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

    this._serverPromise2 = serve(
      (req) => {
        const res = this._transport2.handler(req);

        return res;
      },
      { hostname: "0.0.0.0", port: 9091, signal: this._controller2.signal },
    );

    this._serverPromise3 = serve(
      this._transport3.handler,
      { hostname: "0.0.0.0", port: 9092, signal: this._controller3.signal },
    );

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

    this._controller2.abort();
    this._controller3.abort();

    await this._serverPromise2;
    await this._serverPromise3;
  }
}

class WebsocketPeerScenario implements PeerSyncHelper {
  name = "Peers over Websockets";
  _peer2 = new Peer();
  _transport2: Rpc.TransportWebsocketServer<SyncerBag>;
  _controller2: AbortController;
  _serverPromise2: Promise<void> | null = null;
  _syncer2: Syncer<Rpc.TransportWebsocketServer<SyncerBag>>;

  _peer3 = new Peer();
  _transport3: Rpc.TransportWebsocketServer<SyncerBag>;
  _controller3: AbortController;
  _serverPromise3: Promise<void> | null = null;
  _syncer3: Syncer<Rpc.TransportWebsocketServer<SyncerBag>>;

  constructor() {
    this._transport2 = new Rpc.TransportWebsocketServer({
      url: "",
      deviceId: this._peer2.peerId,
      methods: makeSyncerBag(this._peer2),
    });

    this._transport3 = new Rpc.TransportWebsocketServer({
      url: "",
      deviceId: this._peer3.peerId,
      methods: makeSyncerBag(this._peer3),
    });

    this._controller2 = new AbortController();
    this._controller3 = new AbortController();

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

    this._serverPromise2 = serve(
      this._transport2.reqHandler,
      { hostname: "0.0.0.0", port: 9091, signal: this._controller2.signal },
    );

    this._serverPromise3 = serve(
      this._transport3.reqHandler,
      { hostname: "0.0.0.0", port: 9092, signal: this._controller3.signal },
    );

    return Promise.resolve(["ws://localhost:9091", "ws://localhost:9092"]);
  }

  addNonSyncingStorages(
    dStorages: Replica[],
  ) {
    const [, storageD2, storageD3] = dStorages;
    this._peer2.addReplica(storageD2);
    this._peer3.addReplica(storageD3);
  }

  async close() {
    const removers2 = this._peer2.replicas().map((storage) =>
      () => {
        this._peer2.removeReplica(storage);
      }
    );
    const removers3 = this._peer3.replicas().map((storage) =>
      () => {
        this._peer3.removeReplica(storage);
      }
    );

    await Promise.all([...removers2, ...removers3]);

    this._syncer2.close();
    this._syncer3.close();

    this._controller2.abort();
    this._controller3.abort();

    await this._serverPromise2;
    await this._serverPromise3;
  }
}

export default [...universalSyncScenarios, {
  name: "HTTP Peers",
  make: () => new HttpPeerScenario(),
}, {
  name: "Websocket Peers",
  make: () => new WebsocketPeerScenario(),
}];
