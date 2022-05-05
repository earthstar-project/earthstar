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
  scenario: T;
};

export const cryptoDrivers: Scenario<ICryptoDriver>[] = [{
  name: "Noble",
  scenario: CryptoDriverNoble,
}, {
  name: "Sodium",
  scenario: CryptoDriverSodium,
}];

export const replicaDrivers: Scenario<
  (share: ShareAddress) => IReplicaDriver
>[] = [
  { name: "Memory", scenario: (addr) => new ReplicaDriverMemory(addr) },
  {
    name: "LocalStorage",
    scenario: (addr) => new ReplicaDriverLocalStorage(addr),
  },
  {
    name: "Sqlite",
    scenario: (addr) =>
      new ReplicaDriverSqlite({
        filename: `${addr}.bench.sqlite`,
        mode: "create-or-open",
        share: addr,
      }),
  },
];
