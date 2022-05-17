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
  const keypairB = await Crypto.generateAuthorKeypair("nest") as AuthorKeypair;

  const replica = new Replica({ driver });

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

  Deno.bench(
    `Replica.queryDocs (path ASC) (${scenario.name})`,
    { group: "queryDocs.pathAsc" },
    async () => {
      await replica.queryDocs({
        orderBy: "path ASC",
      });
    },
  );

  Deno.bench(
    `Replica.queryDocs (localIndex ASC) (${scenario.name})`,
    { group: "queryDocs.localIndexAsc" },
    async () => {
      await replica.queryDocs({
        orderBy: "localIndex ASC",
      });
    },
  );

  Deno.bench(
    `Replica.getLatestDocAtPath (${scenario.name})`,
    { group: "getLatestDocAtPath" },
    async () => {
      await replica.getLatestDocAtPath("/stable.txt");
    },
  );

  Deno.bench(
    `Replica.getAllDocsAtPath (${scenario.name})`,
    { group: "getAllDocsAtPath" },
    async () => {
      await replica.getAllDocsAtPath("/stable.txt");
    },
  );
}
