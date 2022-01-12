import { testScenarios } from './test-scenarios.node';
import { runQueryHelpersTests } from './query-helpers.shared';

for (let scenario of testScenarios) {
  runQueryHelpersTests(scenario);
}
