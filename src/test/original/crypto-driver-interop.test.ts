import { assert, assertEquals } from "../asserts.ts";

import { ICryptoDriver, KeypairBytes } from "../../crypto/crypto-types.ts";
import { identifyBufOrBytes } from "../../util/bytes.ts";
import { testCryptoScenarios } from "../test-scenarios.ts";

//================================================================================

export let runCryptoDriverInteropTests = (drivers: ICryptoDriver[]) => {
    let TEST_NAME = "crypto-driver-interop shared tests";
    let SUBTEST_NAME = drivers.map((driver) => (driver as any).name).join(
        " + ",
    );

    Deno.test(
        SUBTEST_NAME + ": compare sigs from each driver",
        async () => {
            let msg = "hello";
            let keypairBytes: KeypairBytes = await drivers[0]
                .generateKeypairBytes();
            let keypairName = (drivers[0] as any).name;
            let sigs: { name: string; sig: Uint8Array }[] = [];
            for (let signer of drivers) {
                let sig = await signer.sign(keypairBytes, msg);
                assertEquals(
                    identifyBufOrBytes(sig),
                    "bytes",
                    "signature is bytes, not buffer",
                );
                sigs.push({ name: (signer as any).name, sig });
            }
            for (let ii = 0; ii < sigs.length - 1; ii++) {
                let sigs0 = sigs[ii];
                let sigs1 = sigs[ii + 1];
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
            let msg = "hello";
            for (let signer of drivers) {
                let keypairBytes: KeypairBytes = await drivers[0]
                    .generateKeypairBytes();
                let sig = await signer.sign(keypairBytes, msg);
                let signerName = (signer as any).name;
                for (let verifier of drivers) {
                    let verifierName = (verifier as any).name;
                    assert(
                        verifier.verify(keypairBytes.pubkey, sig, msg),
                        `keypair and signature by ${signerName} was verified by ${verifierName}`,
                    );
                }
            }
        },
    );
};

runCryptoDriverInteropTests(
    testCryptoScenarios.map((scenario) => scenario.driver),
);
