import { Crypto } from "../../crypto/crypto.ts";
import { setGlobalCryptoDriver } from "../../crypto/global-crypto-driver.ts";
import { Replica } from "../../replica/replica.ts";
import { SyncAgent } from "../../syncer/sync_agent.ts";
import { AuthorKeypair } from "../../util/doc-types.ts";
import { writeRandomDocs } from "../test-utils.ts";
import {
  cryptoDrivers,
  ItemType,
  MultiplyOutput,
  multiplyScenarios,
  replicaDrivers,
} from "./scenarios.ts";

const scenarios: MultiplyOutput<{
  "replicaDriver": ItemType<typeof replicaDrivers>;
  "crypto": ItemType<typeof cryptoDrivers>;
}> = multiplyScenarios({
  description: "replicaDriver",
  scenarios: replicaDrivers,
}, {
  description: "crypto",
  scenarios: cryptoDrivers,
});

const SHARE_ADDR = "+test.a123";

for (const scenario of scenarios) {
  const replicaDriver = scenario.subscenarios.replicaDriver;
  const crypto = scenario.subscenarios.crypto;

  setGlobalCryptoDriver(crypto);

  const keypair = await Crypto.generateAuthorKeypair("test") as AuthorKeypair;
  const keypairB = await Crypto.generateAuthorKeypair("nest") as AuthorKeypair;

  Deno.bench(
    `SyncAgent sync 5 docs each side (${scenario.name})`,
    async () => {
      const replicaA = new Replica({ driver: replicaDriver(SHARE_ADDR, "a") });
      const replicaB = new Replica({ driver: replicaDriver(SHARE_ADDR, "b") });

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

      const unsubA = syncAgentA.onStatusUpdate((status) => {
        console.log("A", status);
      });

      const unsubB = syncAgentB.onStatusUpdate((status) => {
        console.log("B", status);
      });

      syncAgentA.readable.pipeTo(syncAgentB.writable);
      syncAgentB.readable.pipeTo(syncAgentA.writable);

      console.log(syncAgentA.getStatus());
      console.log(syncAgentB.getStatus());

      await syncAgentA.isDone;
      await syncAgentB.isDone;

      unsubA();
      unsubB();
    },
  );
}
