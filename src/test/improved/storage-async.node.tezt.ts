import { testScenarios } from "./test-scenarios.node.ts";
import { runStorageAsyncTests } from "./storage-async.shared.ts";

for (let scenario of testScenarios) {
  runStorageAsyncTests(scenario);
}
