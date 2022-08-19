import { Crypto } from "../../crypto/crypto.ts";
import { isErr } from "../../util/errors.ts";
import { bytesToStream, streamToBytes } from "../../util/streams.ts";
import { assert, assertEquals } from "../asserts.ts";
import { attachmentDriverScenarios } from "../scenarios/scenarios.ts";
import { AttachmentDriverScenario, Scenario } from "../scenarios/types.ts";

function runAttachmentDriverTests(
  scenario: Scenario<AttachmentDriverScenario>,
) {
  Deno.test(`Attachment driver (${scenario.name})`, async (test) => {
    const driver = scenario.item.makeDriver("+fake.a123");
    const fakeFormat = "es.fake";

    await test.step({
      name: ".stage + .commit (bytes)",
      fn: async () => {
        const bytes = new TextEncoder().encode("Hello!");
        const expectedHash = await Crypto.sha256base32(bytes);

        const res = await driver.stage(fakeFormat, bytes);

        assert(!isErr(res));

        assertEquals(res.hash, expectedHash);

        await res.commit();

        const hopefullyAttachment = await driver.getAttachment(
          fakeFormat,
          res.hash,
        );

        assert(hopefullyAttachment);

        assertEquals(
          "Hello!",
          new TextDecoder().decode(await hopefullyAttachment.bytes()),
          "attachment bytes match",
        );
        assertEquals(
          "Hello!",
          new TextDecoder().decode(
            await streamToBytes(await hopefullyAttachment.stream()),
          ),
          "attachment stream matches",
        );
      },
      sanitizeResources: false,
    });

    await driver.wipe();

    await test.step({
      name: ".stage + .reject (bytes)",
      fn: async () => {
        const bytes = new TextEncoder().encode("Hello!");
        const expectedHash = await Crypto.sha256base32(bytes);

        const res = await driver.stage(fakeFormat, bytes);

        assert(!isErr(res));

        assertEquals(res.hash, expectedHash);

        await res.reject();

        const hopefullyUndefined = await driver.getAttachment(
          fakeFormat,
          res.hash,
        );

        assertEquals(hopefullyUndefined, undefined);
      },
      sanitizeResources: false,
      sanitizeOps: false,
    });

    await driver.wipe();

    await test.step({
      name: ".stage + .commit (stream)",
      fn: async () => {
        const bytes = new TextEncoder().encode("Hello!");
        const expectedHash = await Crypto.sha256base32(bytes);
        const stream = bytesToStream(bytes);

        await driver.stage(fakeFormat, stream);

        const res = await driver.stage(fakeFormat, bytes);

        assert(!isErr(res));

        assertEquals(res.hash, expectedHash);

        await res.commit();

        const hopefullyAttachment = await driver.getAttachment(
          fakeFormat,
          res.hash,
        );

        assert(hopefullyAttachment);

        assertEquals(
          "Hello!",
          new TextDecoder().decode(await hopefullyAttachment.bytes()),
        );
        assertEquals(
          "Hello!",
          new TextDecoder().decode(
            await streamToBytes(await hopefullyAttachment.stream()),
          ),
        );
      },
      sanitizeResources: false,
      sanitizeOps: false,
    });

    await driver.wipe();

    await test.step({
      name: ".stage + .reject (stream)",
      fn: async () => {
        const bytes = new TextEncoder().encode("Hello!");
        const expectedHash = await Crypto.sha256base32(bytes);
        const stream = bytesToStream(bytes);

        await driver.stage(fakeFormat, stream);

        const res = await driver.stage(fakeFormat, bytes);

        assert(!isErr(res));

        assertEquals(res.hash, expectedHash);

        await res.reject();

        const hopefullyUndefined = await driver.getAttachment(
          fakeFormat,
          res.hash,
        );

        assertEquals(hopefullyUndefined, undefined);
      },
      sanitizeResources: false,
      sanitizeOps: false,
    });

    await driver.wipe();

    await test.step({
      name: ".erase",
      fn: async () => {
        const bytes = new TextEncoder().encode("Hello!");

        const res = await driver.stage(fakeFormat, bytes);

        assert(!isErr(res));

        await res.commit();

        await driver.erase(fakeFormat, res.hash);

        const hopefullyUndefined = await driver.getAttachment(
          fakeFormat,
          res.hash,
        );

        assertEquals(
          hopefullyUndefined,
          undefined,
          "Getting erased attachment returns undefined",
        );
      },
      sanitizeResources: false,
      sanitizeOps: false,
    });

    await driver.wipe();

    await test.step({
      name: ".wipe",
      fn: async () => {
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
          const hopefullyUndefined = await driver.getAttachment(
            fakeFormat,
            hash,
          );

          hopefullyUndefineds.push(hopefullyUndefined);
        }

        assertEquals(
          hopefullyUndefineds,
          [undefined, undefined, undefined],
          "Getting erased attachments returns undefined",
        );
      },
      sanitizeResources: false,
      sanitizeOps: false,
    });

    await driver.wipe();

    await test.step({
      name: ".filter",
      fn: async () => {
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

        const [hashToKeep] = hashes;

        const filtered = await driver.filter({
          "es.fake": new Set([hashToKeep]),
        });

        const results = [];

        for (const hash of hashes) {
          const hopefullyUndefined = await driver.getAttachment(
            fakeFormat,
            hash,
          );

          results.push(hopefullyUndefined);
        }

        assert(results[0], "first hash was in the store");
        assertEquals(results[1], undefined, "second hash was not in the store");
        assertEquals(results[2], undefined, "third hash was not in the store");

        assertEquals(filtered.length, 2);
        assert(filtered.find((erased) => erased.hash === hashes[1]));
        assert(filtered.find((erased) => erased.hash === hashes[2]));
      },
      sanitizeResources: false,
      sanitizeOps: false,
    });

    await driver.wipe();
  });
}

for (const scenario of attachmentDriverScenarios) {
  runAttachmentDriverTests(scenario);
}
