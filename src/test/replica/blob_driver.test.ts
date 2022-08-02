// test that wipe wipes

import { Crypto } from "../../crypto/crypto.ts";
import { IReplicaBlobDriver } from "../../replica/replica-types.ts";
import { isErr } from "../../util/errors.ts";
import { bytesToStream, streamToBytes } from "../../util/streams.ts";
import { assert, assertEquals } from "../asserts.ts";
import { blobDriverScenarios } from "../scenarios/scenarios.ts";
import { Scenario } from "../scenarios/types.ts";

function runBlobDriverTests(scenario: Scenario<() => IReplicaBlobDriver>) {
  Deno.test(`Blob driver (${scenario.name})`, async (test) => {
    const driver = scenario.item();
    const fakeFormat = "es.fake";

    await test.step(".stage + commit (bytes)", async () => {
      const bytes = new TextEncoder().encode("Hello!");
      const expectedHash = await Crypto.sha256base32(bytes);

      const res = await driver.stage(fakeFormat, bytes);

      assert(!isErr(res));

      assertEquals(res.hash, expectedHash);

      await res.commit();

      const hopefullyBlob = await driver.getBlob(fakeFormat, res.hash);

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

    await test.step(".stage + .reject (bytes)", async () => {
      const bytes = new TextEncoder().encode("Hello!");
      const expectedHash = await Crypto.sha256base32(bytes);

      const res = await driver.stage(fakeFormat, bytes);

      assert(!isErr(res));

      assertEquals(res.hash, expectedHash);

      await res.reject();

      const hopefullyUndefined = await driver.getBlob(fakeFormat, res.hash);

      assertEquals(hopefullyUndefined, undefined);
    });

    await driver.wipe();

    await test.step(".stage + .commit (stream)", async () => {
      const bytes = new TextEncoder().encode("Hello!");
      const expectedHash = await Crypto.sha256base32(bytes);
      const stream = bytesToStream(bytes);

      await driver.stage(fakeFormat, stream);

      const res = await driver.stage(fakeFormat, bytes);

      assert(!isErr(res));

      assertEquals(res.hash, expectedHash);

      await res.commit();

      const hopefullyBlob = await driver.getBlob(fakeFormat, res.hash);

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

    await test.step(".stage + .reject (stream)", async () => {
      const bytes = new TextEncoder().encode("Hello!");
      const expectedHash = await Crypto.sha256base32(bytes);
      const stream = bytesToStream(bytes);

      await driver.stage(fakeFormat, stream);

      const res = await driver.stage(fakeFormat, bytes);

      assert(!isErr(res));

      assertEquals(res.hash, expectedHash);

      await res.reject();

      const hopefullyUndefined = await driver.getBlob(fakeFormat, res.hash);

      assertEquals(hopefullyUndefined, undefined);
    });

    await driver.wipe();

    await test.step(".erase", async () => {
      const bytes = new TextEncoder().encode("Hello!");

      const res = await driver.stage(fakeFormat, bytes);

      assert(!isErr(res));

      await res.commit();

      await driver.erase(fakeFormat, res.hash);

      const hopefullyUndefined = await driver.getBlob(fakeFormat, res.hash);

      assertEquals(
        hopefullyUndefined,
        undefined,
        "Getting erased blob returns undefined",
      );
    });

    await driver.wipe();

    await test.step(".wipe", async () => {
      const bytes0 = new TextEncoder().encode("Hello!");
      const bytes1 = new TextEncoder().encode("Hey!");
      const bytes2 = new TextEncoder().encode("Yo!");

      const hashes: string[] = [];

      for (const bytes of [bytes0, bytes1, bytes2]) {
        const res = await driver.stage(fakeFormat, bytes);

        assert(!isErr(res));

        hashes.push(res.hash);

        await res.commit();
      }

      await driver.wipe();

      const hopefullyUndefineds = [];

      for (const hash of hashes) {
        const hopefullyUndefined = await driver.getBlob(fakeFormat, hash);

        hopefullyUndefineds.push(hopefullyUndefined);
      }

      assertEquals(
        hopefullyUndefineds,
        [undefined, undefined, undefined],
        "Getting erased blobs returns undefined",
      );
    });

    await driver.wipe();
  });
}

for (const scenario of blobDriverScenarios) {
  runBlobDriverTests(scenario);
}
