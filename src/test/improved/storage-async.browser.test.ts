import { testScenarios } from './test-scenarios.browser';
import { runStorageAsyncTests } from './storage-async.shared';

for (let scenario of testScenarios) {
    runStorageAsyncTests(scenario);
}
