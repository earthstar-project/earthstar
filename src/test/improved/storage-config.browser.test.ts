import { testScenarios } from './test-scenarios.browser';
import { runStorageConfigTests } from './storage-config.shared';

for (let scenario of testScenarios) {
    runStorageConfigTests(scenario);
}
