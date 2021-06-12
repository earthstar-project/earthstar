import { testScenarios } from './test-scenarios.node';
import { runStorageAsyncTests } from './storage-async.shared';

for (let scenario of testScenarios) {
    runStorageAsyncTests(scenario);
}
