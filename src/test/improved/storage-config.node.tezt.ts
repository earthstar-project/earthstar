import { testScenarios } from "./test-scenarios.node.ts";
import { runStorageConfigTests } from "./storage-config.shared.ts";

for (let scenario of testScenarios) {
  runStorageConfigTests(scenario);
}
