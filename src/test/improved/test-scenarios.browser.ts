// basic earthstar types
import { WorkspaceAddress } from "../../util/doc-types.ts";
import { IStorageDriverAsync } from "../../storage/storage-types.ts";

// specific drivers
import { CryptoDriverNoble } from "../../crypto/crypto-driver-noble.ts";
import { StorageDriverAsyncMemory } from "../../storage/storage-driver-async-memory.ts";
import { StorageDriverLocalStorage } from "../../storage/storage-driver-local-storage.ts";

// TODO-DENO: Conditionally add indexed DB / chloride based on env

//import { StorageDriverIndexedDB } from "../../storage/storage-driver-indexeddb.ts";

// test types
import { TestScenario } from "./test-scenario-types.ts";

//================================================================================

export let testScenarios: TestScenario[] = [
  {
    name: "StorageDriverAsyncMemory + CryptoDriverNoble",
    cryptoDriver: CryptoDriverNoble,
    persistent: false,
    platforms: { browser: true, node: true, deno: true },
    makeDriver: (ws: WorkspaceAddress): IStorageDriverAsync =>
      new StorageDriverAsyncMemory(ws),
  },
  {
    name: "StorageDriverLocalStorage + CryptoDriverNoble",
    cryptoDriver: CryptoDriverNoble,
    persistent: true,
    platforms: { browser: true, node: false, deno: false },
    makeDriver: (ws: WorkspaceAddress): IStorageDriverAsync =>
      new StorageDriverLocalStorage(ws),
  },
];

//================================================================================

//for (let scenario of scenarios) {
//    runStorageDriverTests(scenario);
//    runStorageConfigTests(scenario);
//    runStorageTests(scenario);
//}
//
