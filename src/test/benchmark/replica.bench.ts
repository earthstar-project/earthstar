import { Crypto } from "../../crypto/crypto.ts";
import { setGlobalCryptoDriver } from "../../crypto/global-crypto-driver.ts";
import { Replica } from "../../replica/replica.ts";
import { AuthorKeypair } from "../../util/doc-types.ts";
import { randomId } from "../../util/misc.ts";
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

for (const scenario of scenarios) {
  const replicaDriver = scenario.subscenarios.replicaDriver;
  const crypto = scenario.subscenarios.crypto;

  const SHARE_ADDR = "+test.a123";
  const driverToClose = replicaDriver(SHARE_ADDR, scenario.name);

  const keypair = await Crypto.generateAuthorKeypair("test") as AuthorKeypair;
  const keypairB = await Crypto.generateAuthorKeypair("nest") as AuthorKeypair;

  const replicaToClose = new Replica({ driver: driverToClose });

  await replicaToClose.close(true);
  const driver = replicaDriver(SHARE_ADDR, scenario.name);
  const replica = new Replica({ driver });

  await writeRandomDocs(keypair, replica, 100);

  await replica.set(keypair, {
    format: "es.4",
    content: "hello",
    path: `/stable.txt`,
  });

  await replica.set(keypairB, {
    format: "es.4",
    content: "howdy",
    path: `/stable.txt`,
  });

  Deno.bench(`Replica.set (${scenario.name})`, { group: "set" }, async () => {
    setGlobalCryptoDriver(crypto);
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
      setGlobalCryptoDriver(crypto);
      await replica.queryDocs();
    },
  );

  Deno.bench(
    `Replica.queryDocs (path ASC) (${scenario.name})`,
    { group: "queryDocs.pathAsc" },
    async () => {
      setGlobalCryptoDriver(crypto);
      await replica.queryDocs({
        orderBy: "path ASC",
      });
    },
  );

  Deno.bench(
    `Replica.queryDocs (localIndex ASC) (${scenario.name})`,
    { group: "queryDocs.localIndexAsc" },
    async () => {
      setGlobalCryptoDriver(crypto);
      await replica.queryDocs({
        orderBy: "localIndex ASC",
      });
    },
  );

  Deno.bench(
    `Replica.getLatestDocAtPath (${scenario.name})`,
    { group: "getLatestDocAtPath" },
    async () => {
      setGlobalCryptoDriver(crypto);
      await replica.getLatestDocAtPath("/stable.txt");
    },
  );

  Deno.bench(
    `Replica.getAllDocsAtPath (${scenario.name})`,
    { group: "getAllDocsAtPath" },
    async () => {
      setGlobalCryptoDriver(crypto);
      await replica.getAllDocsAtPath("/stable.txt");
    },
  );
}
