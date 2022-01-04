import { testScenarios } from "./test-scenarios.node.ts";
import { runStorageDriverTests } from "./storage-driver-async.shared.ts";

for (let scenario of testScenarios) {
  runStorageDriverTests(scenario);
}
