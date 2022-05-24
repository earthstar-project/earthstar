import { MultiplyScenarioOutput, Scenarios } from "./types.ts";

export function multiplyScenarios<DescType extends string>(
  ...scenarios: Scenarios<DescType, any>[]
): MultiplyScenarioOutput<any> {
  const output: MultiplyScenarioOutput<any> = [];

  const [head, ...rest] = scenarios;

  if (!head) {
    return [];
  }

  for (const scenario of head.scenarios) {
    const restReses = multiplyScenarios(...rest);

    if (restReses.length === 0) {
      output.push({
        name: scenario.name,
        subscenarios: {
          [head.description]: scenario.item,
        },
      });
    }

    for (const restRes of restReses) {
      const thing = {
        name: `${scenario.name} + ${restRes.name}`,
        subscenarios: {
          [head.description]: scenario.item,
          ...restRes.subscenarios,
        },
      };

      output.push(thing);
    }
  }

  return output;
}
