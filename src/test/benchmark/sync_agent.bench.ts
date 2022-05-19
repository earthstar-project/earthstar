import { Crypto } from "../../crypto/crypto.ts";
import { setGlobalCryptoDriver } from "../../crypto/global-crypto-driver.ts";
import { Replica } from "../../replica/replica.ts";
import { SyncAgent } from "../../syncer/sync_agent.ts";
import { AuthorKeypair } from "../../util/doc-types.ts";
import { writeRandomDocs } from "../test-utils.ts";
import { cryptoScenarios, replicaScenarios } from "../scenarios/scenarios.ts";
import { MultiplyScenarioOutput, ScenarioItem } from "../scenarios/types.ts";
import { multiplyScenarios } from "../scenarios/utils.ts";

const scenarios: MultiplyScenarioOutput<{
  "replicaDriver": ScenarioItem<typeof replicaScenarios>;
  "crypto": ScenarioItem<typeof cryptoScenarios>;
}> = multiplyScenarios({
  description: "replicaDriver",
  scenarios: replicaScenarios,
}, {
  description: "crypto",
  scenarios: cryptoScenarios,
});

const SHARE_ADDR = "+test.a123";

for (const scenario of scenarios) {
  const replicaDriver = scenario.subscenarios.replicaDriver;
  const crypto = scenario.subscenarios.crypto;

  const keypair = await Crypto.generateAuthorKeypair("test") as AuthorKeypair;
  const keypairB = await Crypto.generateAuthorKeypair("nest") as AuthorKeypair;

  Deno.bench(
    `SyncAgent sync 5 docs each side (${scenario.name})`,
    async () => {
      setGlobalCryptoDriver(crypto);

      const replicaA = new Replica({
        driver: replicaDriver.makeDriver(SHARE_ADDR, "a"),
      });
      const replicaB = new Replica({
        driver: replicaDriver.makeDriver(SHARE_ADDR, "b"),
      });

      await writeRandomDocs(keypair, replicaA, 5);
      await writeRandomDocs(keypairB, replicaB, 5);

      const syncAgentA = new SyncAgent({
        replica: replicaA,
        mode: "only_existing",
      });
      const syncAgentB = new SyncAgent({
        replica: replicaB,
        mode: "only_existing",
      });

      syncAgentA.readable.pipeTo(syncAgentB.writable);
      syncAgentB.readable.pipeTo(syncAgentA.writable);

      await syncAgentA.isDone;
      await syncAgentB.isDone;
    },
  );
}
