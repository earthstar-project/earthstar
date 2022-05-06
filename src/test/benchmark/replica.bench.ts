function deleteTheThing() {
  throw new Error("Function not implemented.");
}
import { Crypto } from "../../crypto/crypto.ts";
import { setGlobalCryptoDriver } from "../../crypto/global-crypto-driver.ts";
import { Replica } from "../../replica/replica.ts";
import { AuthorKeypair } from "../../util/doc-types.ts";
import { randomId } from "../../util/misc.ts";
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

for (const scenario of scenarios) {
  const replicaDriver = scenario.subscenarios.replicaDriver;
  const crypto = scenario.subscenarios.crypto;

  const SHARE_ADDR = "+test.a123";
  const driver = replicaDriver(SHARE_ADDR);

  setGlobalCryptoDriver(crypto);

  const keypair = await Crypto.generateAuthorKeypair("test") as AuthorKeypair;

  const replica = new Replica({ driver });

  Deno.bench(`Replica.set (${scenario.name})`, { group: "set" }, async () => {
    await replica.set(keypair, {
      format: "es.4",
      content: "hi",
      path: `/test/${randomId()}.txt`,
    });
  });

  Deno.bench(
    `Replica.queryDocs (${scenario.name})`,
    { group: "queryDocs" },
    async () => {
      await replica.queryDocs();
    },
  );
}
