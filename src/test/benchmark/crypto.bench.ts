import { randomId } from "../../util/misc.ts";
import { cryptoDrivers } from "./scenarios.ts";

for (const scenario of cryptoDrivers) {
  const keypairBytes = await scenario.item.generateKeypairBytes();
  const message = "hello" + randomId() + randomId();
  const sigBytes = await scenario.item.sign(keypairBytes, message);

  Deno.bench(`generateKeypairBytes (${scenario.name})`, {
    group: "generateKeypairBytes",
  }, async () => {
    await scenario.item.generateKeypairBytes();
  });

  Deno.bench(`sha256 (${scenario.name})`, { group: "sha256" }, async () => {
    await scenario.item.sha256(message);
  });

  Deno.bench(`sign (${scenario.name})`, { group: "sign" }, async () => {
    await scenario.item.sign(keypairBytes, message);
  });

  Deno.bench(`validate (${scenario.name})`, { group: "validate" }, async () => {
    await scenario.item.verify(keypairBytes.pubkey, sigBytes, message);
  });
}
