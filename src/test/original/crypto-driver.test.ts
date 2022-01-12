import { assert, assertEquals, assertNotEquals } from "../asserts.ts";
import { snowmanBytes, snowmanString } from "../test-utils.ts";
//t.runOnly = true;

import { identifyBufOrBytes, stringToBytes } from "../../util/bytes.ts";

import { base32StringToBytes } from "../../crypto/base32.ts";
import { testCryptoScenarios } from "../test-scenarios.ts";
import { CryptoScenario } from "../test-scenario-types.ts";

//================================================================================

export let runCryptoDriverTests = (scenario: CryptoScenario) => {
    const { driver, name } = scenario;
    let TEST_NAME = "crypto-driver shared tests";
    let SUBTEST_NAME = name;

    Deno.test(
        SUBTEST_NAME + ": sha256(bytes | string) --> bytes",
        async () => {
            let vectors: [Uint8Array | string, Uint8Array][] = [
                // input, output
                [
                    "",
                    base32StringToBytes(
                        "b4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq",
                    ),
                ],
                [
                    stringToBytes(""),
                    base32StringToBytes(
                        "b4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq",
                    ),
                ],
                [
                    "abc",
                    base32StringToBytes(
                        "bxj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq",
                    ),
                ],
                [
                    stringToBytes("abc"),
                    base32StringToBytes(
                        "bxj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq",
                    ),
                ],
                [
                    snowmanString,
                    base32StringToBytes(
                        "bkfsdgyoht3fo6jni32ac3yspk4f2exm4fxy5elmu7lpbdnhum3ga",
                    ),
                ],
                [
                    snowmanBytes,
                    base32StringToBytes(
                        "bkfsdgyoht3fo6jni32ac3yspk4f2exm4fxy5elmu7lpbdnhum3ga",
                    ),
                ],
                // we're not supposed to feed it Buffers but let's find out what happens when we do.
                /*
            [stringToBuffer('abc'), base32StringToBytes('bxj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq')],
            [stringToBuffer(''), base32StringToBytes('b4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq')],
            [stringToBuffer(snowmanString), base32StringToBytes('bkfsdgyoht3fo6jni32ac3yspk4f2exm4fxy5elmu7lpbdnhum3ga')],
            */
            ];
            for (let [input, expectedResult] of vectors) {
                let actualResult = await driver.sha256(input);
                assertEquals(
                    identifyBufOrBytes(actualResult),
                    "bytes",
                    "sha256 outputs bytes",
                );
                assertEquals(
                    actualResult.length,
                    32,
                    "sha256 outputs 32 bytes",
                );
                assertEquals(
                    actualResult,
                    expectedResult,
                    `hash of bytes or string: ${JSON.stringify(input)}`,
                );
            }
        },
    );

    Deno.test(SUBTEST_NAME + ": generateKeypairBytes", async () => {
        let keypair = await driver.generateKeypairBytes();
        assertEquals(
            identifyBufOrBytes(keypair.pubkey),
            "bytes",
            "keypair.pubkey is bytes",
        );
        assertEquals(
            identifyBufOrBytes(keypair.secret),
            "bytes",
            "keypair.secret is bytes",
        );
        assertEquals(keypair.pubkey.length, 32, "pubkey is 32 bytes long");
        assertEquals(keypair.secret.length, 32, "secret is 32 bytes long");
        assertNotEquals(keypair.secret, keypair.pubkey, "secret is !== pubkey");

        let keypair2 = await driver.generateKeypairBytes();
        assertNotEquals(
            keypair.pubkey,
            keypair2.pubkey,
            "generateKeypairBytes is non-deterministic (pubkey)",
        );
        assertNotEquals(
            keypair.secret,
            keypair2.secret,
            "generateKeypairBytes is non-deterministic (secret)",
        );
    });

    Deno.test(SUBTEST_NAME + ": sign and verify", async () => {
        let keypairBytes = await driver.generateKeypairBytes();
        let msg = "hello";
        let sigBytes = await driver.sign(keypairBytes, msg);

        assertEquals(
            identifyBufOrBytes(sigBytes),
            "bytes",
            "signature is bytes, not buffer",
        );
        assertEquals(sigBytes.length, 64, "sig is 64 bytes long");

        assert(
            await driver.verify(keypairBytes.pubkey, sigBytes, msg),
            "signature is valid",
        );

        assertEquals(
            await driver.verify(keypairBytes.pubkey, sigBytes, msg + "!"),
            false,
            "signature is invalid after message is changed",
        );

        // change the sig and see if it's still valid
        sigBytes[0] = (sigBytes[0] + 1) % 256;
        assertEquals(
            await driver.verify(keypairBytes.pubkey, sigBytes, msg),
            false,
            "signature is invalid after signature is changed",
        );
    });
};

for (const scenario of testCryptoScenarios) {
    runCryptoDriverTests(scenario);
}
