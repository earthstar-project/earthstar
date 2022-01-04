// basic earthstar types
import { WorkspaceAddress } from "../../util/doc-types.ts";
import { IStorageDriverAsync } from "../../storage/storage-types.ts";

// specific drivers
import { CryptoDriverTweetnacl } from "../../crypto/crypto-driver-tweetnacl.ts";
import { CryptoDriverNode } from "../../crypto/crypto-driver-node.ts";
import { StorageDriverAsyncMemory } from "../../storage/storage-driver-async-memory.ts";

// test types
import { TestScenario } from "./test-scenario-types.ts";

//================================================================================

export let testScenarios: TestScenario[] = [
  {
    name: "StorageDriverAsyncMemory + CryptoDriverTweetnacl",
    cryptoDriver: CryptoDriverTweetnacl,
    persistent: false,
    platforms: { browser: true, node: true, deno: true },
    makeDriver: (ws: WorkspaceAddress): IStorageDriverAsync =>
      new StorageDriverAsyncMemory(ws),
  },
  {
    name: "StorageDriverAsyncMemory + CryptoDriverNode",
    cryptoDriver: CryptoDriverNode,
    persistent: false,
    platforms: { browser: true, node: true, deno: true },
    makeDriver: (ws: WorkspaceAddress): IStorageDriverAsync =>
      new StorageDriverAsyncMemory(ws),
  },
];

//================================================================================

//for (let scenario of scenarios) {
//    runStorageDriverTests(scenario);
//    runStorageConfigTests(scenario);
//    runStorageTests(scenario);
//}
//
