import { testScenarios } from './test-scenarios.node';
import { runQueryFollowerTests } from './query-follower.shared';

for (let scenario of testScenarios) {
    runQueryFollowerTests(scenario);
}
