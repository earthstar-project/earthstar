import { randomId } from "../../util/misc.ts";
import { cryptoDrivers } from "./scenarios.ts";

for (const driver of cryptoDrivers) {
  const keypairBytes = await driver.scenario.generateKeypairBytes();
  const message = "hello" + randomId() + randomId();
  const sigBytes = await driver.scenario.sign(keypairBytes, message);

  Deno.bench(`${driver.name} + generateKeypairBytes`, {
    group: "generateKeypairBytes",
  }, async () => {
    await driver.scenario.generateKeypairBytes();
  });

  Deno.bench(`${driver.name} + sha256`, { group: "sha256" }, async () => {
    await driver.scenario.sha256(message);
  });

  Deno.bench(`${driver.name} + sign`, { group: "sign" }, async () => {
    await driver.scenario.sign(keypairBytes, message);
  });

  Deno.bench(`${driver.name} + validate`, { group: "validate" }, async () => {
    await driver.scenario.verify(keypairBytes.pubkey, sigBytes, message);
  });
}
