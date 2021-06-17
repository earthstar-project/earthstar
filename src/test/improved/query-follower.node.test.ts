import { testScenarios } from './test-scenarios.node';
import { runQueryFollower3Tests } from './query-follower.shared';

for (let scenario of testScenarios) {
    runQueryFollower3Tests(scenario);
}
