import { isDeno, isNode } from "https://deno.land/x/which_runtime@0.2.0/mod.ts";

// specific crypto drivers
import { CryptoDriverNoble } from "../crypto/crypto-driver-noble.ts";
import { CryptoDriverNode } from "../crypto/crypto-driver-node.js";
import { CryptoDriverChloride } from "../crypto/crypto-driver-chloride.ts";

// specific storage drivers
import { ReplicaDriverMemory } from "../replica/replica-driver-memory.ts";
import { ReplicaDriverLocalStorage } from "../replica/replica-driver-local-storage.ts";
import { ReplicaDriverIndexedDB } from "../replica/replica-driver-indexeddb.ts";
import { ReplicaDriverSqlite } from "../replica/replica-driver-sqlite.deno.ts";

// test types
import {
  CryptoScenario,
  TestScenario,
  TransportScenario,
} from "./test-scenario-types.ts";

// A version of test scenario without crypto specified yet.
type JustStorageScenario = Omit<TestScenario, "cryptoDriver">;

// ----------------------------------------------------------
// Storage only scenarios, grouped by capability

const universalStorageScenarios: JustStorageScenario[] = [
  {
    name: "ReplicaDriverAsyncMemory",
    persistent: false,
    makeDriver: (ws) => new ReplicaDriverMemory(ws),
    builtInConfigKeys: [],
  },
  {
    name: "ReplicaDriverSqlite",
    persistent: true,
    makeDriver: (ws) =>
      new ReplicaDriverSqlite({
        filename: `src/test/${ws}.db`,
        mode: "create-or-open",
        share: ws,
      }),
    builtInConfigKeys: ["schemaVersion", "share"],
  },
];

const browserStorageScenarios: JustStorageScenario[] = [
  {
    name: "ReplicaDriverLocalStorage",
    persistent: true,
    makeDriver: (ws) => new ReplicaDriverLocalStorage(ws),
    builtInConfigKeys: [],
  },
];

const browserOnlyStorageScenarios: JustStorageScenario[] = [
  {
    name: "ReplicaDriverIndexedDB",
    persistent: true,
    makeDriver: (ws) => new ReplicaDriverIndexedDB(ws),
    builtInConfigKeys: [],
  },
];

// ----------------------------------------------------------
// Crypto scenarios, grouped by platform

const universalCryptoScenarios: CryptoScenario[] = [
  {
    name: "CryptoDriverNoble",
    driver: CryptoDriverNoble,
  },
];

const nodeCryptoScenarios: CryptoScenario[] = [
  {
    name: "CryptoDriverNode",
    driver: CryptoDriverNode,
  },
  {
    name: "CryptoDriverChloride",
    driver: CryptoDriverChloride,
  },
];

// ----------------------------------------------------------
// Zip them all together into platforms

function makeScenarios(
  storageScenarios: JustStorageScenario[],
  cryptoScenarios: CryptoScenario[],
): TestScenario[] {
  return storageScenarios.flatMap((storageScenario) => {
    return cryptoScenarios.map((cryptoScenario) => ({
      ...storageScenario,
      name: `${storageScenario.name} + ${cryptoScenario.name}`,
      cryptoDriver: cryptoScenario.driver,
    }));
  });
}

const browserScenarios = makeScenarios(
  [
    ...universalStorageScenarios,
    ...browserStorageScenarios,
    ...browserOnlyStorageScenarios,
  ],
  [...universalCryptoScenarios],
);

const denoScenarios = makeScenarios(
  [
    ...universalStorageScenarios,
    ...browserStorageScenarios,
  ],
  [...universalCryptoScenarios],
);

const nodeScenarios = makeScenarios(
  [
    ...universalStorageScenarios,
  ],
  [...universalCryptoScenarios, ...nodeCryptoScenarios],
);

function getScenarios() {
  if (isDeno) {
    return denoScenarios;
  } else if (isNode) {
    return nodeScenarios;
  }

  return browserScenarios;
}

function getCryptoScenarios() {
  if (isDeno) {
    return [...universalCryptoScenarios];
  } else if (isNode) {
    return [...universalCryptoScenarios, ...nodeCryptoScenarios];
  }

  return [...universalCryptoScenarios];
}

//================================================================================

export const testScenarios: TestScenario[] = getScenarios();
export const testCryptoScenarios: CryptoScenario[] = getCryptoScenarios();
