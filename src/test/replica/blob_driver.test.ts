// test that wipe wipes

import { IReplicaBlobDriver } from "../../replica/replica-types.ts";
import { bytesToStream, streamToBytes } from "../../util/streams.ts";
import { assert, assertEquals } from "../asserts.ts";
import { blobDriverScenarios } from "../scenarios/scenarios.ts";
import { Scenario } from "../scenarios/types.ts";

function runBlobDriverTests(scenario: Scenario<() => IReplicaBlobDriver>) {
  Deno.test(`Blob driver (${scenario.name})`, async (test) => {
    const driver = scenario.item();

    await test.step(".upsert (bytes)", async () => {
      const fakeSig = "aaaaabbbbbccccc";
      const bytes = new TextEncoder().encode("Hello!");

      await driver.upsert(fakeSig, bytes);

      const hopefullyBlob = await driver.getBlob(fakeSig);

      assert(hopefullyBlob);

      assertEquals(
        "Hello!",
        new TextDecoder().decode(await hopefullyBlob.bytes()),
        "blob bytes match",
      );
      assertEquals(
        "Hello!",
        new TextDecoder().decode(await streamToBytes(hopefullyBlob.stream)),
        "blob stream matches",
      );
    });

    await driver.wipe();

    await test.step(".upsert (stream)", async () => {
      const fakeSig = "aaaaabbbbbccccc";
      const bytes = new TextEncoder().encode("Hello!");
      const stream = bytesToStream(bytes);

      await driver.upsert(fakeSig, stream);

      const hopefullyBlob = await driver.getBlob(fakeSig);

      assert(hopefullyBlob);

      assertEquals(
        "Hello!",
        new TextDecoder().decode(await hopefullyBlob.bytes()),
      );
      assertEquals(
        "Hello!",
        new TextDecoder().decode(await streamToBytes(hopefullyBlob.stream)),
      );
    });

    await driver.wipe();

    await test.step(".erase", async () => {
      const fakeSig = "aaaaabbbbbccccc";
      const bytes = new TextEncoder().encode("Hello!");

      await driver.upsert(fakeSig, bytes);

      await driver.erase(fakeSig);

      const hopefullyUndefined = await driver.getBlob(fakeSig);

      assertEquals(
        hopefullyUndefined,
        undefined,
        "Getting erased blob returns undefined",
      );
    });

    await driver.wipe();

    await test.step(".wipe", async () => {
      const fakeSig = "aaaaabbbbbccccc";
      const fakeSig2 = "111122223333";
      const fakeSig3 = "etauhsoetnheaosntuh";

      const bytes = new TextEncoder().encode("Hello!");

      await driver.upsert(fakeSig, bytes);
      await driver.upsert(fakeSig2, bytes);
      await driver.upsert(fakeSig3, bytes);

      await driver.wipe();

      const hopefullyUndefined = await driver.getBlob(fakeSig);
      const hopefullyUndefined2 = await driver.getBlob(fakeSig2);
      const hopefullyUndefined3 = await driver.getBlob(fakeSig3);

      assertEquals(
        [hopefullyUndefined, hopefullyUndefined2, hopefullyUndefined3],
        [undefined, undefined, undefined],
        "Getting erased blob returns undefined",
      );
    });

    await driver.wipe();
  });
}

for (const scenario of blobDriverScenarios) {
  runBlobDriverTests(scenario);
}
