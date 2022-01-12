import { testScenarios } from './test-scenarios.browser';
import { runQueryHelpersTests } from './query-helpers.shared';

for (let scenario of testScenarios) {
  runQueryHelpersTests(scenario);
}
