import { assert, assertEquals } from "../asserts.ts";

import { ICryptoDriver, KeypairBytes } from "../../crypto/crypto-types.ts";
import { identifyBufOrBytes } from "../../util/bytes.ts";
import { cryptoScenarios } from "../scenarios/scenarios.ts";
import { Scenario } from "../scenarios/types.ts";

//================================================================================

export function runCryptoDriverInteropTests(
  scenario: Scenario<ICryptoDriver>[],
) {
  const TEST_NAME = "crypto-driver-interop shared tests";
  const SUBTEST_NAME = scenario.map((scenario) => scenario.name).join(
    " + ",
  );
  const drivers = scenario.map(({ item }) => item);

  Deno.test(
    SUBTEST_NAME + ": compare sigs from each driver",
    async () => {
      const msg = "hello";
      const keypairBytes: KeypairBytes = await drivers[0]
        .generateKeypairBytes();
      const keypairName = (drivers[0] as any).name;
      const sigs: { name: string; sig: Uint8Array }[] = [];
      for (const signer of drivers) {
        const sig = await signer.sign(keypairBytes, msg);
        assertEquals(
          identifyBufOrBytes(sig),
          "bytes",
          "signature is bytes, not buffer",
        );
        sigs.push({ name: (signer as any).name, sig });
      }
      for (let ii = 0; ii < sigs.length - 1; ii++) {
        const sigs0 = sigs[ii];
        const sigs1 = sigs[ii + 1];
        assertEquals(
          sigs0.sig,
          sigs1.sig,
          `keypair by ${keypairName}; signature by ${sigs0.name} matches signature by ${sigs1.name}`,
        );
      }
    },
  );

  Deno.test(
    SUBTEST_NAME + ": sign with one driver, verify with another",
    async () => {
      const msg = "hello";
      for (const signer of drivers) {
        const keypairBytes: KeypairBytes = await drivers[0]
          .generateKeypairBytes();
        const sig = await signer.sign(keypairBytes, msg);
        const signerName = (signer as any).name;
        for (const verifier of drivers) {
          const verifierName = (verifier as any).name;
          assert(
            verifier.verify(keypairBytes.pubkey, sig, msg),
            `keypair and signature by ${signerName} was verified by ${verifierName}`,
          );
        }
      }
    },
  );
}

runCryptoDriverInteropTests(
  cryptoScenarios,
);
