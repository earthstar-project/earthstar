import { testScenarios } from './test-scenarios.browser';
import { runQueryFollower3Tests } from './query-follower.shared';

for (let scenario of testScenarios) {
    runQueryFollower3Tests(scenario);
}
