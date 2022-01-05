import { isDeno, isNode } from "https://deno.land/x/which_runtime/mod.ts";

// basic earthstar types
import { WorkspaceAddress } from "../../util/doc-types.ts";
import { IStorageDriverAsync } from "../../storage/storage-types.ts";
import { ICryptoDriver } from "../../crypto/crypto-types.ts";

// specific drivers
import { CryptoDriverNoble } from "../../crypto/crypto-driver-noble.ts";
import { StorageDriverAsyncMemory } from "../../storage/storage-driver-async-memory.ts";
import { StorageDriverLocalStorage } from "../../storage/storage-driver-local-storage.ts";
import { StorageDriverIndexedDB } from "../../storage/storage-driver-indexeddb.ts";

// test types
import { TestScenario } from "./test-scenario-types.ts";

// A version of test scenario without crypto specified yet.
type JustStorageScenario = Omit<TestScenario, "cryptoDriver">;
type CryptoScenario = { name: string; driver: ICryptoDriver };

// ----------------------------------------------------------
// Storage only scenarios, grouped by capability

const universalStorageScenarios: JustStorageScenario[] = [
  {
    name: "StorageDriverAsyncMemory",
    persistent: false,
    makeDriver: (ws) => new StorageDriverAsyncMemory(ws),
  },
];

const browserStorageScenarios: JustStorageScenario[] = [
  {
    name: "StorageDriverLocalStorage",
    persistent: true,
    makeDriver: (ws) => new StorageDriverLocalStorage(ws),
  },
];

const browserOnlyStorageScenarios: JustStorageScenario[] = [
  {
    name: "StorageDriverIndexedDB",
    persistent: true,
    makeDriver: (ws) => new StorageDriverIndexedDB(ws),
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
  [...universalCryptoScenarios],
);

function getScenarios() {
  if (isDeno) {
    return denoScenarios;
  } else if (isNode) {
    return nodeScenarios;
  }

  return browserScenarios;
}

//================================================================================

export const testScenarios: TestScenario[] = getScenarios();
