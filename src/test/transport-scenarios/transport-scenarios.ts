import {
  TransportScenario,
  TransportTestHelper,
} from "../test-scenario-types.ts";
import { Peer } from "../../peer/peer.ts";
import { Opine, opine, Rpc, serve } from "../test-deps.ts";
import { makeSyncerBag, SyncerBag } from "../../syncer/_syncer-bag.ts";
import { sleep } from "../../util/misc.ts";
import { transportScenarioLocal } from "./transport-scenarios.universal.ts";

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

    return sleep(100);
  }
}

class TransportHelperWebsocket implements TransportTestHelper {
  name = "TransportWebsocketClient + TransportWebsocketServer";
  clientPeer: Peer;
  targetPeer: Peer;
  clientTransport: Rpc.TransportWebsocketClient<SyncerBag>;
  targetTransport: Rpc.TransportWebsocketServer<SyncerBag>;
  _controller: AbortController;
  _serverPromise: Promise<void>;

  constructor(peer: Peer, targetPeer: Peer) {
    this.clientPeer = peer;
    this.targetPeer = targetPeer;

    // Set up server
    this.targetTransport = new Rpc.TransportWebsocketServer({
      // This is unused ... should ditch this option.
      url: "",
      deviceId: targetPeer.peerId,
      methods: makeSyncerBag(targetPeer),
    });

    this._controller = new AbortController();

    this._serverPromise = serve(
      //
      this.targetTransport.reqHandler,
      { hostname: "0.0.0.0", port: 3456, signal: this._controller.signal },
    );

    // Set up client
    this.clientTransport = new Rpc.TransportWebsocketClient({
      deviceId: peer.peerId,
      methods: makeSyncerBag(peer),
    });
  }

  connect() {
    this.clientTransport.addConnection("ws://localhost:3456");

    return Promise.resolve();
  }

  teardown() {
    this.clientTransport.close();
    this.targetTransport.close();

    this._controller.abort("End of test");

    return this._serverPromise;
  }
}

const transportScenarioHttp: TransportScenario = {
  name: "TransportHttpClient + TransportHttpServer",
  make: function (peer: Peer, targetPeer: Peer): TransportTestHelper {
    return new TransportHelperHttp(peer, targetPeer);
  },
};

const transportScenarioHttpOpine: TransportScenario = {
  name: "TransportHttpClient + TransportHttpServerOpine",
  make: function (peer: Peer, targetPeer: Peer): TransportTestHelper {
    return new TransportHelperHttpOpine(peer, targetPeer);
  },
};

const transportScenarioWebsocket: TransportScenario = {
  name: "TransportWebsocketClient + TransportWebsocketServer",
  make: function (peer: Peer, targetPeer: Peer): TransportTestHelper {
    return new TransportHelperWebsocket(peer, targetPeer);
  },
};

export default [
  transportScenarioLocal,
  transportScenarioHttp,
  transportScenarioHttpOpine,
  transportScenarioWebsocket,
];
