import { testScenarios } from './test-scenarios.node';
import { runStorageConfigTests } from './storage-config.shared';

for (let scenario of testScenarios) {
    runStorageConfigTests(scenario);
}
