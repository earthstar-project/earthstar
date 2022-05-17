import { CryptoDriverNoble } from "../../crypto/crypto-driver-noble.ts";
import { CryptoDriverSodium } from "../../crypto/crypto-driver-sodium.ts";
import { ICryptoDriver } from "../../crypto/crypto-types.ts";
import { ReplicaDriverLocalStorage } from "../../replica/replica-driver-local-storage.ts";
import { ReplicaDriverMemory } from "../../replica/replica-driver-memory.ts";
import { ReplicaDriverSqlite } from "../../replica/replica-driver-sqlite.deno.ts";
import { IReplicaDriver } from "../../replica/replica-types.ts";
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
