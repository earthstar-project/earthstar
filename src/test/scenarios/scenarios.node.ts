import { ICryptoDriver } from "../../crypto/crypto-types.ts";
import { ReplicaDriverSqlite } from "../../replica/replica-driver-sqlite.node.ts";

import { PartnerScenario, ReplicaScenario, Scenario } from "./types.ts";
import {
  universalCryptoDrivers,
  universalPartners,
  universalReplicaDrivers,
} from "./scenarios.universal.ts";
import { Syncer } from "../../syncer/syncer.ts";
import { PartnerWeb } from "../../syncer/partner_web.ts";
import { IPeer } from "../../peer/peer-types.ts";
import { deferred } from "https://deno.land/std@0.138.0/async/deferred.ts";
//import { WebSocketServer } from "https://esm.sh/ws";
import { CryptoDriverChloride } from "../../crypto/crypto-driver-chloride.ts";
import { sleep } from "../../util/misc.ts";
import { WebSocketServer } from "ws";

export const cryptoScenarios: Scenario<ICryptoDriver>[] = [
  ...universalCryptoDrivers,
  {
    name: "Chloride",
    item: CryptoDriverChloride,
  },
];

export const replicaScenarios: Scenario<ReplicaScenario>[] = [
  ...universalReplicaDrivers,
  {
    name: "Sqlite",
    item: {
      persistent: true,
      builtInConfigKeys: ["schemaVersion", "share"],
      makeDriver: (addr, variant?: string) =>
        new ReplicaDriverSqlite({
          filename: `${addr}.${variant ? `${variant}.` : ""}bench.sqlite`,
          mode: "create-or-open",
          share: addr,
        }),
    },
  },
];

export class PartnerScenarioWeb implements PartnerScenario {
  _server: WebSocketServer;

  constructor() {
    this._server = new WebSocketServer({ port: 8083 });
  }

  async setup(peerA: IPeer, peerB: IPeer) {
    const serverSyncerPromise = deferred<Syncer>();

    // Set up server

    this._server.on("connection", (socket) => {
      const partner = new PartnerWeb({
        socket: socket as unknown as WebSocket,
      });

      serverSyncerPromise.resolve(
        new Syncer({
          partner,
          mode: "once",
          peer: peerB,
        }),
      );
    });

    const clientSocket = new WebSocket("ws://localhost:8083");

    const clientSyncer = new Syncer({
      partner: new PartnerWeb({
        socket: clientSocket,
      }),
      mode: "once",
      peer: peerA,
    });

    const serverSyncer = await serverSyncerPromise;

    return Promise.resolve([clientSyncer, serverSyncer] as [Syncer, Syncer]);
  }

  teardown() {
    this._server.close();
    return sleep(500);
  }
}

export const partnerScenarios = [
  ...universalPartners,
  {
    name: "Web",
    item: () => new PartnerScenarioWeb(),
  },
];
