import { assert, assertEquals } from "../asserts.ts";
import { AuthorKeypair } from "../../util/doc-types.ts";
import { ICryptoDriver } from "../../crypto/crypto-types.ts";
import { isErr, ValidationError } from "../../util/errors.ts";

import {
  decodeAuthorKeypairToBytes,
  encodeAuthorKeypairToStrings,
} from "../../crypto/keypair.ts";
import { Crypto } from "../../crypto/crypto.ts";
import {
  GlobalCryptoDriver,
  setGlobalCryptoDriver,
} from "../../crypto/global-crypto-driver.ts";

import { testCryptoScenarios } from "../test-scenarios.ts";
import { CryptoScenario } from "../test-scenario-types.ts";

//================================================================================

export let runCryptoKeypairTests = (scenario: CryptoScenario) => {
  const { driver, name } = scenario;
  let TEST_NAME = "crypto-keypair shared tests";
  let SUBTEST_NAME = name;

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
      let keypair2 = encodeAuthorKeypairToStrings(shortname, keypairBytes);
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
            address:
              "@suzy.b724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a",
            secret: "bwgwycyh4gytyw4p2cp55t53wqhbxb7kqnj4assaazroviffuqn7a",
          },
        },
        {
          valid: false,
          keypair: {
            address:
              "@suzy.b724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a",
            secret: "b", // valid base32 but wrong length
          },
        },
        {
          valid: false,
          keypair: {
            address:
              "@suzy.b724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a",
            secret: "b???", // invalid base32
          },
        },
        {
          valid: false,
          keypair: {
            address:
              "@suzy.b724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a",
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
            address:
              "@suzy.724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a", // no b
            secret: "bwgwycyh4gytyw4p2cp55t53wqhbxb7kqnj4assaazroviffuqn7a",
          },
        },
        {
          valid: false,
          keypair: {
            address:
              "@suzy.b724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a",
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
};

for (const scenario of testCryptoScenarios) {
  runCryptoKeypairTests(scenario);
}
