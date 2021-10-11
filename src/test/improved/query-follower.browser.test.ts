import { testScenarios } from './test-scenarios.browser';
import { runQueryFollowerTests } from './query-follower.shared';

for (let scenario of testScenarios) {
    runQueryFollowerTests(scenario);
}
