import { assertEquals } from "../asserts.ts";
import { throws } from "../test-utils.ts";
//t.runOnly = true;

import { ShareAddress } from "../../util/doc-types.ts";
import { IReplica, IReplicaDriver } from "../../replica/replica-types.ts";
import {
  GlobalCryptoDriver,
  setGlobalCryptoDriver,
} from "../../crypto/global-crypto-driver.ts";
import { FormatValidatorEs4 } from "../../format-validators/format-validator-es4.ts";
import { Replica } from "../../replica/replica.ts";

import { TestScenario } from "../test-scenario-types.ts";
import { testScenarios } from "../test-scenarios.ts";

//================================================================================

import { Logger, LogLevel, setLogLevel } from "../../util/log.ts";
let loggerTest = new Logger("test", "brightWhite");
let loggerTestCb = new Logger("test cb", "white");
let J = JSON.stringify;
//setLogLevel('test', LogLevel.Debug);

//================================================================================

// all of the methods we're testing here are present on both Storage and StorageDriver,
// so we run the entire thing twice -- once running the tests on a Storage, and once
// on its StorageDriver directly.

export function runStorageConfigTests(scenario: TestScenario) {
  _runStorageConfigTests(scenario, "storage");
  _runStorageConfigTests(scenario, "storageDriver");
}

let _runStorageConfigTests = (
  scenario: TestScenario,
  mode: "storage" | "storageDriver",
) => {
  let TEST_NAME = "storage config tests";
  let SUBTEST_NAME = `${scenario.name} (${mode} mode)`;

  let makeStorageOrDriver = (
    share: ShareAddress,
  ): IReplica | IReplicaDriver => {
    let driver = scenario.makeDriver(share);
    return mode === "storage"
      ? new Replica(share, FormatValidatorEs4, driver)
      : driver;
  };

  Deno.test(SUBTEST_NAME + ": config basics, and close", async () => {
    setGlobalCryptoDriver(scenario.cryptoDriver);
    let initialCryptoDriver = GlobalCryptoDriver;

    let share = "+gardening.abcde";
    let storage = makeStorageOrDriver(share);

    // methods in common between Storage and StorageDriver:
    // set, get, list, delete, erase, close

    // empty...
    assertEquals(
      await storage.getConfig("a"),
      undefined,
      `getConfig('nonexistent') --> undefined`,
    );
    assertEquals(
      await storage.listConfigKeys(),
      [...scenario.builtInConfigKeys],
      `listConfigKeys() only contains built-in config keys`,
    );
    assertEquals(
      await storage.deleteConfig("a"),
      false,
      `deleteConfig('nonexistent') --> false`,
    );

    // set some items...
    await storage.setConfig("b", "bb");
    await storage.setConfig("a", "aa");

    // verify items are there...
    assertEquals(await storage.getConfig("a"), "aa", `getConfig works`);
    assertEquals(
      await storage.listConfigKeys(),
      ["a", "b", ...scenario.builtInConfigKeys],
      `listConfigKeys() is ${[
        "a",
        "b",
        ...scenario.builtInConfigKeys,
      ]} (sorted)`,
    );

    await storage.setConfig("a", "aaa");
    assertEquals(
      await storage.getConfig("a"),
      "aaa",
      `getConfig overwrites old value`,
    );

    // delete items
    assertEquals(
      await storage.deleteConfig("a"),
      true,
      "delete returns true on success",
    );
    assertEquals(
      await storage.deleteConfig("a"),
      false,
      "delete returns false if nothing is there",
    );
    assertEquals(
      await storage.getConfig("a"),
      undefined,
      `getConfig returns undefined after deleting the key`,
    );
    assertEquals(
      await storage.listConfigKeys(),
      ["b", ...scenario.builtInConfigKeys],
      `listConfigKeys() is ${[
        "b",
        ...scenario.builtInConfigKeys,
      ]} after deleting 'a'`,
    );

    // close without erasing
    await storage.close(false);
    assertEquals(storage.isClosed(), true, "storage is now closed");

    // config methods should throw when closed
    await throws(async () => {
      await storage.setConfig("x", "xx");
    }, "setConfig should throw if used after close()");
    await throws(async () => {
      await storage.getConfig("b");
    }, "getConfig should throw if used after close()");
    await throws(async () => {
      await storage.listConfigKeys();
    }, "listConfigKeys should throw if used after close()");
    await throws(async () => {
      await storage.deleteConfig("b");
    }, "deleteConfig should throw if used after close()");
    await throws(async () => {
      await storage.close(false);
    }, "close should throw if used after close()");

    // make a new one so we can erase it to clean up
    let storage2 = makeStorageOrDriver(share);
    await storage2.close(true);
    await throws(async () => {
      await storage2.close(true);
    }, "close(true) should throw if used after close(true)");

    assertEquals(
      initialCryptoDriver,
      GlobalCryptoDriver,
      `GlobalCryptoDriver has not changed unexpectedly.  started as ${
        (initialCryptoDriver as any).name
      }, ended as ${(GlobalCryptoDriver as any).name}`,
    );
  });

  Deno.test(
    SUBTEST_NAME + ": config persist after closing and reopening",
    async () => {
      setGlobalCryptoDriver(scenario.cryptoDriver);
      let initialCryptoDriver = GlobalCryptoDriver;

      let share = "+gardening.abcde";
      let storage1 = makeStorageOrDriver(share);

      // set an item
      await storage1.setConfig("a", "aa");

      // close, then reopen the same share, without erasing
      await storage1.close(false);
      assertEquals(storage1.isClosed(), true, "close worked");
      let storage2 = makeStorageOrDriver(share);

      // see if data is still there (depending on the scenario)
      if (scenario.persistent) {
        assertEquals(
          await storage2.getConfig("a"),
          "aa",
          "this kind of storage should persist after close",
        );
      } else {
        assertEquals(
          await storage2.getConfig("a"),
          undefined,
          "this kind of storage should not persist after close",
        );
      }

      // close and erase
      await storage2.close(true);

      assertEquals(
        initialCryptoDriver,
        GlobalCryptoDriver,
        `GlobalCryptoDriver has not changed unexpectedly.  started as ${
          (initialCryptoDriver as any).name
        }, ended as ${(GlobalCryptoDriver as any).name}`,
      );
    },
  );

  Deno.test(
    SUBTEST_NAME + ": config erase should delete data",
    async () => {
      setGlobalCryptoDriver(scenario.cryptoDriver);
      let initialCryptoDriver = GlobalCryptoDriver;

      let share = "+gardening.abcde";
      let storage1 = makeStorageOrDriver(share);

      // set an item
      await storage1.setConfig("a", "aa");

      // close and erase it...
      await storage1.close(true);
      assertEquals(storage1.isClosed(), true, "closing should close");

      // re-open.  data should be gone.
      let storage2 = makeStorageOrDriver(share);
      assertEquals(
        await storage2.getConfig("a"),
        undefined,
        "erase has emptied out the data",
      );

      // clean up
      await storage2.close(true);

      assertEquals(
        initialCryptoDriver,
        GlobalCryptoDriver,
        `GlobalCryptoDriver has not changed unexpectedly.  started as ${
          (initialCryptoDriver as any).name
        }, ended as ${(GlobalCryptoDriver as any).name}`,
      );
    },
  );
};

for (let scenario of testScenarios) {
  runStorageConfigTests(scenario);
}
