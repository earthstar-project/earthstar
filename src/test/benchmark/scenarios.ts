import { serve } from "https://deno.land/std@0.129.0/http/server.ts";
import { deferred } from "https://deno.land/std@0.138.0/async/deferred.ts";
import { CryptoDriverNoble } from "../../crypto/crypto-driver-noble.ts";
import { CryptoDriverSodium } from "../../crypto/crypto-driver-sodium.ts";
import { ICryptoDriver } from "../../crypto/crypto-types.ts";
import { IPeer } from "../../peer/peer-types.ts";
import { ReplicaDriverLocalStorage } from "../../replica/replica-driver-local-storage.ts";
import { ReplicaDriverMemory } from "../../replica/replica-driver-memory.ts";
import { ReplicaDriverSqlite } from "../../replica/replica-driver-sqlite.deno.ts";
import { IReplicaDriver } from "../../replica/replica-types.ts";
import { Syncer } from "../../syncer/syncer.ts";
import { SyncerDriverLocal } from "../../syncer/syncer_driver_local.ts";
import { SyncerDriverWeb } from "../../syncer/syncer_driver_web.ts";
import { ISyncerDriver } from "../../syncer/syncer_types.ts";
import { ShareAddress } from "../../util/doc-types.ts";

type Scenario<T> = {
  name: string;
  item: T;
};

export const cryptoDrivers: Scenario<ICryptoDriver>[] = [{
  name: "Noble",
  item: CryptoDriverNoble,
}, {
  name: "Sodium",
  item: CryptoDriverSodium,
}];

export const replicaDrivers: Scenario<
  (share: ShareAddress, variant?: string) => IReplicaDriver
>[] = [
  { name: "Memory", item: (addr) => new ReplicaDriverMemory(addr) },
  {
    name: "LocalStorage",
    item: (addr, variant?: string) =>
      new ReplicaDriverLocalStorage(addr, variant),
  },
  {
    name: "Sqlite",
    item: (addr, variant?: string) =>
      new ReplicaDriverSqlite({
        filename: `${addr}.${variant ? `${variant}.` : ""}bench.sqlite`,
        mode: "create-or-open",
        share: addr,
      }),
  },
];

// ==================

export interface SyncerDriverScenario {
  setup(peerA: IPeer, peerB: IPeer): Promise<[Syncer, Syncer]>;
  teardown(): Promise<void>;
}

export class ScenarioLocal implements SyncerDriverScenario {
  setup(peerA: IPeer, peerB: IPeer) {
    const driver = new SyncerDriverLocal(peerB, "once");

    const syncerA = new Syncer({
      peer: peerA,
      driver: driver,
      mode: "once",
    });

    return Promise.resolve([syncerA, driver.partnerSyncer] as [Syncer, Syncer]);
  }

  teardown() {
    return Promise.resolve();
  }
}

export class ScenarioWeb implements SyncerDriverScenario {
  private serve: Promise<void> | undefined;
  private abortController: AbortController;

  constructor() {
    this.abortController = new AbortController();
  }

  async setup(peerA: IPeer, peerB: IPeer) {
    const serverSyncerPromise = deferred<Syncer>();

    const handler = (req: Request) => {
      const { socket, response } = Deno.upgradeWebSocket(req);

      const webRequestDriver = new SyncerDriverWeb({ socket });

      serverSyncerPromise.resolve(
        new Syncer({
          driver: webRequestDriver,
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
      driver: new SyncerDriverWeb({
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

export const syncerDrivers: Scenario<() => SyncerDriverScenario>[] = [{
  name: "Local",
  item: () => new ScenarioLocal(),
}, {
  name: "Web",
  item: () => new ScenarioWeb(),
}];

// =====================

/*

[
  { name: Noble x Memory, scenarios: {
    crypto: Noble,
    replicaDriver: ReplicaDriverMemory
  } }
]

*/

export type ItemType<T> = T extends Scenario<infer ItemType>[] ? ItemType
  : never;

type Scenarios<DescType extends string, ScenarioType> = {
  description: DescType;
  scenarios: Scenario<ScenarioType>[];
};

export type MultiplyOutput<RecordType extends Record<string, any>> = {
  name: string;
  subscenarios: RecordType;
}[];

export function multiplyScenarios<DescType extends string>(
  ...scenarios: Scenarios<DescType, any>[]
): MultiplyOutput<any> {
  const output: MultiplyOutput<any> = [];

  const [head, ...rest] = scenarios;

  if (!head) {
    return [];
  }

  for (const scenario of head.scenarios) {
    const restReses = multiplyScenarios(...rest);

    if (restReses.length === 0) {
      output.push({
        name: scenario.name,
        subscenarios: {
          [head.description]: scenario.item,
        },
      });
    }

    for (const restRes of restReses) {
      const thing = {
        name: `${scenario.name} + ${restRes.name}`,
        subscenarios: {
          [head.description]: scenario.item,
          ...restRes.subscenarios,
        },
      };

      output.push(thing);
    }
  }

  return output;
}
