import { assert, assertEquals } from "../asserts.ts";

import { WorkspaceAddress } from "../../util/doc-types.ts";
import { IStorageAsync } from "../../storage/storage-types.ts";
import { GlobalCryptoDriver } from "../../crypto/global-crypto-driver.ts";
import { compareByFn, sortedInPlace } from "../../storage/compare.ts";
import { StorageAsync } from "../../storage/storage-async.ts";
import { FormatValidatorEs4 } from "../../format-validators/format-validator-es4.ts";
import { Peer } from "../../peer/peer.ts";
import { testScenarios } from "../test-scenarios.ts";
import { TestScenario } from "../test-scenario-types.ts";

//================================================================================

import { Logger } from "../../util/log.ts";

let loggerTest = new Logger("test", "whiteBright");
let loggerTestCb = new Logger("test cb", "white");
let J = JSON.stringify;

//setDefaultLogLevel(LogLevel.None);
//setLogLevel('peer', LogLevel.Debug);

//================================================================================

export let runPeerTests = (
  scenario: TestScenario,
) => {
  const { name, makeDriver } = scenario;

  let TEST_NAME = "peer shared tests";
  let SUBTEST_NAME = name;

  let makeStorage = (ws: WorkspaceAddress): IStorageAsync => {
    let stDriver = makeDriver(ws);
    let storage = new StorageAsync(ws, FormatValidatorEs4, stDriver);
    return storage;
  };

  Deno.test(SUBTEST_NAME + ": peer basics", async () => {
    let initialCryptoDriver = GlobalCryptoDriver;

    let workspaces = [
      "+one.ws",
      "+two.ws",
      "+three.ws",
    ];
    let storages = workspaces.map((ws) => makeStorage(ws));

    let sortedWorkspaces = sortedInPlace([...workspaces]);
    let sortedStorages = [...storages];
    sortedStorages.sort(compareByFn((storage) => storage.workspace));

    let peer = new Peer();

    assert(
      typeof peer.peerId === "string" && peer.peerId.length > 5,
      "peer has a peerId",
    );

    assertEquals(
      peer.hasWorkspace("+two.ws"),
      false,
      "does not yet have +two.ws",
    );
    assertEquals(peer.workspaces(), [], "has no workspaces");
    assertEquals(peer.storages(), [], "has no storages");
    assertEquals(peer.size(), 0, "size is zero");

    for (let storage of storages) {
      await peer.addStorage(storage);
    }

    assertEquals(
      peer.hasWorkspace("nope"),
      false,
      "does not have invalid workspace address",
    );
    assertEquals(
      peer.hasWorkspace("+nope.ws"),
      false,
      "does not have +nope.ws workspace",
    );
    assertEquals(
      peer.hasWorkspace("+two.ws"),
      true,
      "now it does have +two.ws",
    );

    assertEquals(
      peer.workspaces(),
      sortedWorkspaces,
      "has all 3 workspaces, sorted",
    );
    assertEquals(
      peer.storages(),
      sortedStorages,
      "has all 3 storages sorted by workspace",
    );
    assertEquals(peer.size(), 3, "size is 3");

    await peer.removeStorageByWorkspace("+one.ws");
    assertEquals(
      peer.workspaces(),
      ["+three.ws", "+two.ws"],
      "removed by workspace address",
    );
    assertEquals(peer.size(), 2, "size is 2");

    await peer.removeStorage(storages[1]); // that's two.ws
    assertEquals(peer.workspaces(), ["+three.ws"], "removed storage instance");
    assertEquals(peer.size(), 1, "size is 1");

    assertEquals(
      initialCryptoDriver,
      GlobalCryptoDriver,
      `GlobalCryptoDriver has not changed unexpectedly.  started as ${
        (initialCryptoDriver as any).name
      }, ended as ${(GlobalCryptoDriver as any).name}`,
    );

    // TODO: eventually test peer.bus events when we have them
  });
};

for (const scenario of testScenarios) {
  runPeerTests(scenario);
}
