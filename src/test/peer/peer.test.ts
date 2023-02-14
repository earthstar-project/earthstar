import { assert, assertEquals } from "../asserts.ts";

import { ShareAddress } from "../../util/doc-types.ts";

import {
  GlobalCryptoDriver,
  setGlobalCryptoDriver,
} from "../../crypto/global-crypto-driver.ts";
import { compareByFn, sortedInPlace } from "../../replica/compare.ts";
import { Replica } from "../../replica/replica.ts";
import { Peer } from "../../peer/peer.ts";

//================================================================================

import { Logger } from "../../util/log.ts";
import { MultiplyScenarioOutput, ScenarioItem } from "../scenarios/types.ts";
import { cryptoScenarios, docDriverScenarios } from "../scenarios/scenarios.ts";
import { multiplyScenarios } from "../scenarios/utils.ts";
import { AttachmentDriverMemory } from "../../replica/attachment_drivers/memory.ts";
import { Crypto } from "../../crypto/crypto.ts";
import { ShareKeypair } from "../../crypto/crypto-types.ts";

const loggerTest = new Logger("test", "lightsalmon");
const loggerTestCb = new Logger("test cb", "salmon");
const J = JSON.stringify;

//setDefaultLogLevel(LogLevel.None);
//setLogLevel('peer', LogLevel.Debug);

//================================================================================

const scenarios: MultiplyScenarioOutput<{
  "replicaDriver": ScenarioItem<typeof docDriverScenarios>;
  "cryptoDriver": ScenarioItem<typeof cryptoScenarios>;
}> = multiplyScenarios({
  description: "replicaDriver",
  scenarios: docDriverScenarios,
}, {
  description: "cryptoDriver",
  scenarios: cryptoScenarios,
});

function runPeerTests(
  scenario: typeof scenarios[number],
) {
  const SUBTEST_NAME = scenario.name;

  setGlobalCryptoDriver(scenario.subscenarios.cryptoDriver);

  function makeStorage(share: ShareAddress, shareSecret: string): Replica {
    const storage = new Replica({
      driver: {
        docDriver: scenario.subscenarios.replicaDriver.makeDriver(share),
        attachmentDriver: new AttachmentDriverMemory(),
      },
      shareSecret,
    });
    return storage;
  }

  Deno.test(SUBTEST_NAME + ": peer basics", async () => {
    const initialCryptoDriver = GlobalCryptoDriver;

    const shares = [
      await Crypto.generateShareKeypair("one"),
      await Crypto.generateShareKeypair("two"),
      await Crypto.generateShareKeypair("three"),
    ] as ShareKeypair[];
    const storages = shares.map((ws) => makeStorage(ws.shareAddress, ""));

    const sortedShares = sortedInPlace([
      ...shares.map((kepair) => kepair.shareAddress),
    ]);
    const sortedStorages = [...storages];
    sortedStorages.sort(compareByFn((storage) => storage.share));

    const peer = new Peer();

    assertEquals(
      peer.hasShare(shares[1].shareAddress),
      false,
      "does not yet have +two",
    );
    assertEquals(peer.shares(), [], "has no shares");
    assertEquals(peer.replicas(), [], "has no replicas");
    assertEquals(peer.size(), 0, "size is zero");

    for (const storage of storages) {
      await peer.addReplica(storage);
    }

    assertEquals(
      peer.hasShare("nope"),
      false,
      "does not have invalid share address",
    );
    assertEquals(
      peer.hasShare("+nope.ws"),
      false,
      "does not have +nope.ws share",
    );
    assertEquals(
      peer.hasShare(shares[1].shareAddress),
      true,
      "now it does have +two",
    );

    assertEquals(
      peer.shares(),
      sortedShares,
      "has all 3 shares, sorted",
    );
    assertEquals(
      peer.replicas(),
      sortedStorages,
      "has all 3 storages sorted by share",
    );
    assertEquals(peer.size(), 3, "size is 3");

    await peer.removeReplicaByShare(shares[0].shareAddress);
    assertEquals(
      peer.shares(),
      [shares[2].shareAddress, shares[1].shareAddress],
      "removed by share address",
    );
    assertEquals(peer.size(), 2, "size is 2");

    await peer.removeReplica(storages[1]); // that's two.ws
    assertEquals(
      peer.shares(),
      [shares[2].shareAddress],
      "removed storage instance",
    );
    assertEquals(peer.size(), 1, "size is 1");

    assertEquals(
      initialCryptoDriver,
      GlobalCryptoDriver,
      `GlobalCryptoDriver has not changed unexpectedly.  started as ${
        (initialCryptoDriver as any).name
      }, ended as ${(GlobalCryptoDriver as any).name}`,
    );

    for (const storage of storages) {
      await storage.close(true);
    }

    // TODO: eventually test peer events when we have them
  });
}

for (const scenario of scenarios) {
  runPeerTests(scenario);
}
