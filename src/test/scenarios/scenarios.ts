import { CryptoDriverSodium } from "../../crypto/crypto-driver-sodium.ts";
import { ICryptoDriver } from "../../crypto/crypto-types.ts";
import { DocDriverLocalStorage } from "../../replica/doc_drivers/localstorage.ts";
import { DocDriverSqlite } from "../../replica/doc_drivers/sqlite.deno.ts";
import { DocDriverSqliteFfi } from "../../replica/doc_drivers/sqlite_ffi.ts";
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
import { serve } from "https://deno.land/std@0.129.0/http/server.ts";

export const cryptoScenarios: Scenario<ICryptoDriver>[] = [
  ...universalCryptoDrivers,
  {
    name: "Sodium",
    item: CryptoDriverSodium,
  },
];

export const replicaScenarios: Scenario<ReplicaScenario>[] = [
  ...universalReplicaDrivers,
  {
    name: "LocalStorage",
    item: {
      persistent: true,
      builtInConfigKeys: [],
      makeDriver: (addr, variant?: string) => ({
        docDriver: new DocDriverLocalStorage(addr, variant),
        blobDriver: null,
      }),
    },
  },
  {
    name: "Sqlite FFI",
    item: {
      persistent: true,
      builtInConfigKeys: ["schemaVersion", "share"],
      makeDriver: (addr, variant?: string) => ({
        docDriver: new DocDriverSqliteFfi({
          filename: `${addr}.${variant ? `${variant}.` : ""}bench.ffi.sqlite`,
          mode: "create-or-open",
          share: addr,
        }),
        blobDriver: null,
      }),
    },
  },
  {
    name: "Sqlite",
    item: {
      persistent: true,
      builtInConfigKeys: ["schemaVersion", "share"],
      makeDriver: (addr, variant?: string) => ({
        docDriver: new DocDriverSqlite({
          filename: `${addr}.${variant ? `${variant}.` : ""}bench.sqlite`,
          mode: "create-or-open",
          share: addr,
        }),
        blobDriver: null,
      }),
    },
  },
];

export class PartnerScenarioWeb implements PartnerScenario {
  private serve: Promise<void> | undefined;
  private abortController: AbortController;

  constructor() {
    this.abortController = new AbortController();
  }

  async setup(peerA: IPeer, peerB: IPeer) {
    const serverSyncerPromise = deferred<Syncer>();

    const handler = (req: Request) => {
      const { socket, response } = Deno.upgradeWebSocket(req);

      const partner = new PartnerWeb({ socket });

      serverSyncerPromise.resolve(
        new Syncer({
          partner,
          mode: "once",
          peer: peerB,
        }),
      );

      return response;
    };

    this.abortController = new AbortController();

    this.serve = serve(handler, {
      hostname: "0.0.0.0",
      port: 8083,
      signal: this.abortController.signal,
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
    this.abortController.abort();

    return this.serve as Promise<void>;
  }
}

export const partnerScenarios = [...universalPartners, {
  name: "Web",
  item: () => new PartnerScenarioWeb(),
}];
