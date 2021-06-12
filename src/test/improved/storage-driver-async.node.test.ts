import { testScenarios } from './test-scenarios.node';
import { runStorageDriverTests } from './storage-driver-async.shared';

for (let scenario of testScenarios) {
    runStorageDriverTests(scenario);
}
