import { assert, assertEquals, assertNotEquals, assertStrictEquals } from "../asserts.ts";
import { snowmanBytes, snowmanString } from "../test-utils.ts";

import { AuthorKeypair } from "../../util/doc-types.ts";
import { ICryptoDriver } from "../../crypto/crypto-types.ts";
import { isErr, ValidationError } from "../../util/errors.ts";

import { stringToBytes } from "../../util/bytes.ts";
import { decodeAuthorKeypairToBytes, encodeAuthorKeypairToStrings } from "../../crypto/keypair.ts";
import { Crypto } from "../../crypto/crypto.ts";
import { GlobalCryptoDriver, setGlobalCryptoDriver } from "../../crypto/global-crypto-driver.ts";
import { testCryptoScenarios } from "../test-scenarios.ts";
import { CryptoScenario } from "../test-scenario-types.ts";

//================================================================================

export function runCryptoTests(scenario: CryptoScenario) {
    const { driver, name } = scenario;
    let TEST_NAME = "crypto shared tests";
    let SUBTEST_NAME = name;

    Deno.test(SUBTEST_NAME + ": sha256 of strings", async () => {
        setGlobalCryptoDriver(driver);

        let vectors: [string, string][] = [
            // input, output
            ["", "b4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq"],
            ["abc", "bxj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq"],
            [
                snowmanString,
                "bkfsdgyoht3fo6jni32ac3yspk4f2exm4fxy5elmu7lpbdnhum3ga",
            ],
        ];

        for (let [input, output] of vectors) {
            assertStrictEquals(
                await Crypto.sha256base32(input),
                output,
                `hash of ${JSON.stringify(input)}`,
            );
        }
        assertEquals(
            driver,
            GlobalCryptoDriver,
            `GlobalCryptoDriver has not changed unexpectedly.  should be ${
                (driver as any).name
            }, was ${(GlobalCryptoDriver as any).name}`,
        );
    });

    Deno.test(SUBTEST_NAME + ": sha256 of bytes", async () => {
        setGlobalCryptoDriver(driver);

        let vectors: [Uint8Array, string][] = [
            // input, output
            [
                stringToBytes(""),
                "b4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq",
            ],
            [
                Uint8Array.from([]),
                "b4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq",
            ],
            [
                stringToBytes("abc"),
                "bxj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq",
            ],
            [
                Uint8Array.from([97, 98, 99]),
                "bxj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq",
            ],
            // snowman in utf-8
            [
                snowmanBytes,
                "bkfsdgyoht3fo6jni32ac3yspk4f2exm4fxy5elmu7lpbdnhum3ga",
            ],
        ];
        for (let [input, output] of vectors) {
            assertStrictEquals(
                await Crypto.sha256base32(input),
                output,
                `hash of bytes: ${JSON.stringify(input)}`,
            );
        }
        assertEquals(
            driver,
            GlobalCryptoDriver,
            `GlobalCryptoDriver has not changed unexpectedly.  should be ${
                (driver as any).name
            }, was ${(GlobalCryptoDriver as any).name}`,
        );
    });

    Deno.test(SUBTEST_NAME + ": generateAuthorKeypair", async () => {
        setGlobalCryptoDriver(driver);

        assert(
            isErr(await Crypto.generateAuthorKeypair("abc")),
            "error when author shortname is too short",
        );
        assert(
            isErr(await Crypto.generateAuthorKeypair("abcde")),
            "error when author shortname is too long",
        );
        assert(
            isErr(await Crypto.generateAuthorKeypair("TEST")),
            "error when author shortname is uppercase",
        );
        assert(
            isErr(await Crypto.generateAuthorKeypair("1abc")),
            "error when author shortname starts with a number",
        );
        assert(
            isErr(await Crypto.generateAuthorKeypair("abc-")),
            "error when author shortname has dashes",
        );
        assert(
            isErr(await Crypto.generateAuthorKeypair("abc.")),
            "error when author shortname has a dot",
        );
        assert(
            isErr(await Crypto.generateAuthorKeypair("abc ")),
            "error when author shortname has a space",
        );
        assert(
            isErr(await Crypto.generateAuthorKeypair("")),
            "error when author shortname is empty",
        );

        let keypair = await Crypto.generateAuthorKeypair("ok99");
        if (isErr(keypair)) {
            assert(
                false,
                "should have succeeded but instead was an error: " + keypair,
            );

            return;
        } else {
            assertStrictEquals(
                typeof keypair.address,
                "string",
                "keypair has address",
            );
            assertStrictEquals(
                typeof keypair.secret,
                "string",
                "keypair has secret",
            );
            assert(
                keypair.address.startsWith("@ok99."),
                "keypair.address starts with @ok99.",
            );
            assert(
                keypair.secret.startsWith("b"),
                'keypair.secret starts with "b"',
            );
        }

        let keypair2 = await Crypto.generateAuthorKeypair("ok99");
        if (isErr(keypair2)) {
            assert(
                false,
                "should have succeeded but instead was an error: " + keypair2,
            );
        } else {
            assertNotEquals(
                keypair.address,
                keypair2.address,
                "keypair crypto.generation is not deterministic (pubkeys differ)",
            );
            assertNotEquals(
                keypair.secret,
                keypair2.secret,
                "keypair crypto.generation is not deterministic (secrets differ)",
            );
        }

        assertEquals(
            driver,
            GlobalCryptoDriver,
            `GlobalCryptoDriver has not changed unexpectedly.  should be ${
                (driver as any).name
            }, was ${(GlobalCryptoDriver as any).name}`,
        );
    });

    Deno.test(SUBTEST_NAME + ": authorKeypairIsValid", async () => {
        setGlobalCryptoDriver(driver);

        let keypair1 = await Crypto.generateAuthorKeypair("onee");
        let keypair2 = await Crypto.generateAuthorKeypair("twoo");
        if (isErr(keypair1)) {
            assert(false, "keypair1 was not generated successfully");

            return;
        }
        if (isErr(keypair2)) {
            assert(false, "keypair2 was not generated successfully");

            return;
        }

        assertStrictEquals(
            await Crypto.checkAuthorKeypairIsValid(keypair1),
            true,
            "keypair1 is valid",
        );
        assertNotEquals(
            keypair1.secret,
            keypair2.secret,
            "different keypairs have different secrets",
        );

        assert(
            isErr(
                await Crypto.checkAuthorKeypairIsValid({
                    address: "",
                    secret: keypair1.secret,
                }),
            ),
            "empty address makes keypair invalid",
        );

        assert(
            isErr(
                await Crypto.checkAuthorKeypairIsValid({
                    address: keypair1.address,
                    secret: "",
                }),
            ),
            "empty secret makes keypair invalid",
        );

        assert(
            isErr(
                await Crypto.checkAuthorKeypairIsValid({
                    address: keypair1.address + "a",
                    secret: keypair1.secret,
                }),
            ),
            "adding char to pubkey makes keypair invalid",
        );

        assert(
            isErr(
                await Crypto.checkAuthorKeypairIsValid({
                    address: keypair1.address,
                    secret: keypair1.secret + "a",
                }),
            ),
            "adding char to secret makes keypair invalid",
        );

        assert(
            isErr(
                await Crypto.checkAuthorKeypairIsValid({
                    address: keypair1.address.slice(0, -8) + "aaaaaaaa",
                    secret: keypair1.secret,
                }),
            ),
            "altering pubkey makes keypair invalid",
        );

        assert(
            isErr(
                await Crypto.checkAuthorKeypairIsValid({
                    address: keypair1.address,
                    secret: keypair1.secret.slice(0, -8) + "aaaaaaaa",
                }),
            ),
            "altering secret makes keypair invalid",
        );

        assert(
            isErr(
                await Crypto.checkAuthorKeypairIsValid({
                    address: keypair1.address,
                    secret: keypair2.secret,
                }),
            ),
            "mixing address and secret from 2 different keypairs is invalid",
        );

        assert(
            isErr(
                await Crypto.checkAuthorKeypairIsValid({
                    address: keypair1.address,
                    secret: keypair1.secret.slice(0, -1) + "1", // 1 is not a valid b32 character
                }),
            ),
            "invalid b32 char in address makes keypair invalid",
        );

        assert(
            isErr(
                await Crypto.checkAuthorKeypairIsValid({
                    address: keypair1.address,
                    secret: keypair1.secret.slice(0, -1) + "1", // 1 is not a valid b32 character
                }),
            ),
            "invalid b32 char in secret makes keypair invalid",
        );

        assert(
            isErr(
                await Crypto.checkAuthorKeypairIsValid({
                    secret: keypair1.secret,
                } as any),
            ),
            "missing address is invalid",
        );

        assert(
            isErr(
                await Crypto.checkAuthorKeypairIsValid({
                    address: keypair1.address,
                } as any),
            ),
            "missing secret is invalid",
        );

        assertEquals(
            driver,
            GlobalCryptoDriver,
            `GlobalCryptoDriver has not changed unexpectedly.  should be ${
                (driver as any).name
            }, was ${(GlobalCryptoDriver as any).name}`,
        );
    });

    Deno.test(
        SUBTEST_NAME +
            ": encode/decode author keypair: from bytes to string and back",
        async () => {
            setGlobalCryptoDriver(driver);

            let shortname = "test";
            let keypair = await Crypto.generateAuthorKeypair(shortname);
            if (isErr(keypair)) {
                assert(false, "keypair 1 is an error");

                return;
            }
            let keypairBytes = decodeAuthorKeypairToBytes(keypair);
            if (isErr(keypairBytes)) {
                assert(false, "keypairBytes is an error");

                return;
            }
            let keypair2 = encodeAuthorKeypairToStrings(
                shortname,
                keypairBytes,
            );
            if (isErr(keypair2)) {
                assert(false, "keypair 2 is an error");

                return;
            }
            let keypairBytes2 = decodeAuthorKeypairToBytes(keypair);
            if (isErr(keypairBytes2)) {
                assert(false, "keypairBytes2 is an error");

                return;
            }

            assertEquals(
                keypair,
                keypair2,
                "keypair encoding/decoding roundtrip matched (strings)",
            );
            assertEquals(
                keypairBytes,
                keypairBytes2,
                "keypair encoding/decoding roundtrip matched (bytes)",
            );

            keypair.secret = "x";
            let err1 = decodeAuthorKeypairToBytes(keypair);
            assert(
                isErr(err1),
                'decodeAuthorKeypairToBytes returns an error if the secret is bad base32 (no leading "b")',
            );

            keypair.secret = "b1";
            let err2 = decodeAuthorKeypairToBytes(keypair);
            assert(
                isErr(err2),
                "decodeAuthorKeypairToBytes returns an error if the secret is bad base32 (invalid base32 character)",
            );

            // we test for base32-too-short later in another test

            assertEquals(
                driver,
                GlobalCryptoDriver,
                `GlobalCryptoDriver has not changed unexpectedly.  should be ${
                    (driver as any).name
                }, was ${(GlobalCryptoDriver as any).name}`,
            );
        },
    );

    Deno.test(SUBTEST_NAME + ": signatures", async () => {
        setGlobalCryptoDriver(driver);

        let input = "abc";

        let keypair = await Crypto.generateAuthorKeypair(
            "test",
        ) as AuthorKeypair;
        let keypair2 = await Crypto.generateAuthorKeypair(
            "fooo",
        ) as AuthorKeypair;
        if (isErr(keypair) || isErr(keypair2)) {
            assert(false, "keypair generation error");
            return;
        }

        let sig = await Crypto.sign(keypair, input);
        let sig2 = await Crypto.sign(keypair2, input);
        if (isErr(sig)) {
            assert(false, "signature error " + sig);
            return;
        }
        if (isErr(sig2)) {
            assert(false, "signature error " + sig2);
            return;
        }

        assert(
            await Crypto.verify(keypair.address, sig, input),
            "real signature is valid",
        );

        // ways a signature should fail
        assertEquals(
            await Crypto.verify(keypair.address, "bad sig", input),
            false,
            "garbage signature is not valid",
        );
        assertEquals(
            await Crypto.verify(keypair.address, sig2, input),
            false,
            "signature from another key is not valid",
        );
        assertEquals(
            await Crypto.verify(keypair.address, sig, "different input"),
            false,
            "signature is not valid with different input",
        );
        assertEquals(
            await Crypto.verify("@bad.address", sig, input),
            false,
            "invalid author address = invalid signature, return false",
        );

        // determinism
        assertStrictEquals(
            await Crypto.sign(keypair, "aaa"),
            await Crypto.sign(keypair, "aaa"),
            "signatures should be deterministic",
        );

        // changing input should change signature
        assertNotEquals(
            await Crypto.sign(keypair, "aaa"),
            await Crypto.sign(keypair, "xxx"),
            "different inputs should make different signature",
        );
        assertNotEquals(
            await Crypto.sign(keypair, "aaa"),
            await Crypto.sign(keypair2, "aaa"),
            "different keys should make different signature",
        );

        // encoding of input msg
        let snowmanStringSig = await Crypto.sign(keypair, snowmanString);
        let snowmanBytesSig = await Crypto.sign(keypair, snowmanBytes);
        if (isErr(snowmanStringSig)) {
            assert(false, "signature error " + snowmanStringSig);
        }
        if (isErr(snowmanBytesSig)) {
            assert(false, "signature error " + snowmanBytesSig);
        }
        assert(
            await Crypto.verify(
                keypair.address,
                snowmanStringSig,
                snowmanString,
            ),
            "signature roundtrip works on snowman utf-8 string",
        );
        assert(
            await Crypto.verify(keypair.address, snowmanBytesSig, snowmanBytes),
            "signature roundtrip works on snowman Uint8Array",
        );

        assertEquals(
            driver,
            GlobalCryptoDriver,
            `GlobalCryptoDriver has not changed unexpectedly.  should be ${
                (driver as any).name
            }, was ${(GlobalCryptoDriver as any).name}`,
        );
    });

    Deno.test(
        SUBTEST_NAME + ": decodeAuthorKeypairToBytes checks Uint8Array length",
        () => {
            setGlobalCryptoDriver(driver);

            interface Vector {
                valid: Boolean;
                keypair: AuthorKeypair;
            }
            let vectors: Vector[] = [
                {
                    valid: true,
                    keypair: {
                        address: "@suzy.b724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a",
                        secret: "bwgwycyh4gytyw4p2cp55t53wqhbxb7kqnj4assaazroviffuqn7a",
                    },
                },
                {
                    valid: false,
                    keypair: {
                        address: "@suzy.b724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a",
                        secret: "b", // valid base32 but wrong length
                    },
                },
                {
                    valid: false,
                    keypair: {
                        address: "@suzy.b724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a",
                        secret: "b???", // invalid base32
                    },
                },
                {
                    valid: false,
                    keypair: {
                        address: "@suzy.b724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a",
                        secret: "baa", // valid base32 but wrong length
                    },
                },
                {
                    valid: false,
                    keypair: {
                        address: "@suzy.b", // valid base32 but wrong length
                        secret: "bwgwycyh4gytyw4p2cp55t53wqhbxb7kqnj4assaazroviffuqn7a",
                    },
                },
                {
                    valid: false,
                    keypair: {
                        address: "@suzy.b???", // invalid base32
                        secret: "bwgwycyh4gytyw4p2cp55t53wqhbxb7kqnj4assaazroviffuqn7a",
                    },
                },
                {
                    valid: false,
                    keypair: {
                        address: "@suzy.baa", // valid base32 but wrong length
                        secret: "bwgwycyh4gytyw4p2cp55t53wqhbxb7kqnj4assaazroviffuqn7a",
                    },
                },
                {
                    valid: false,
                    keypair: {
                        address: "@suzy.724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a", // no b
                        secret: "bwgwycyh4gytyw4p2cp55t53wqhbxb7kqnj4assaazroviffuqn7a",
                    },
                },
                {
                    valid: false,
                    keypair: {
                        address: "@suzy.b724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a",
                        secret: "wgwycyh4gytyw4p2cp55t53wqhbxb7kqnj4assaazroviffuqn7a", // no b
                    },
                },
            ];

            for (let { valid, keypair } of vectors) {
                let keypairBytesOrErr = decodeAuthorKeypairToBytes(keypair);
                if (valid) {
                    assertEquals(
                        keypairBytesOrErr instanceof ValidationError,
                        false,
                        "should not be an error: " + JSON.stringify(keypair),
                    );
                } else {
                    assertEquals(
                        keypairBytesOrErr instanceof ValidationError,
                        true,
                        "should be an error: " + JSON.stringify(keypair),
                    );
                }
            }
            assertEquals(
                driver,
                GlobalCryptoDriver,
                `GlobalCryptoDriver has not changed unexpectedly.  should be ${
                    (driver as any).name
                }, was ${(GlobalCryptoDriver as any).name}`,
            );
        },
    );
}

for (const scenario of testCryptoScenarios) {
    runCryptoTests(scenario);
}
