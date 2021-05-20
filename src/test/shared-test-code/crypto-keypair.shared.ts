import t = require('tap');
import { onFinishOneTest } from '../browser-run-exit';

import {
    AuthorKeypair
} from '../../util/doc-types';
import {
    ICryptoDriver
} from '../../crypto/crypto-types';
import {
    isErr,
    ValidationError,
} from '../../util/errors';

import {
    decodeAuthorKeypairToBytes,
    encodeAuthorKeypairToStrings,
} from '../../crypto/keypair';
import {
    Crypto,
} from '../../crypto/crypto';
import {
    GlobalCryptoDriver,
    setGlobalCryptoDriver,
} from '../../crypto/global-crypto-driver';

//================================================================================

export let runCryptoKeypairTests = (driver: ICryptoDriver) => {
    let TEST_NAME = 'crypto-keypair shared tests';
    let SUBTEST_NAME = (driver as any).name;

    // Boilerplate to help browser-run know when this test is completed.
    // When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function.
    /* istanbul ignore next */ 
    (t.test as any)?.onFinish?.(() => onFinishOneTest(TEST_NAME, SUBTEST_NAME));

    t.test(SUBTEST_NAME + ': encode/decode author keypair: from bytes to string and back', (t: any) => {
        setGlobalCryptoDriver(driver);

        let shortname = 'test';
        let keypair = Crypto.generateAuthorKeypair(shortname);
        if (isErr(keypair)) {
            t.ok(false, 'keypair 1 is an error');
            t.end();
            return;
        }
        let keypairBytes = decodeAuthorKeypairToBytes(keypair);
        if (isErr(keypairBytes)) {
            t.ok(false, 'keypairBytes is an error');
            t.end();
            return;
        };
        let keypair2 = encodeAuthorKeypairToStrings(shortname, keypairBytes);
        if (isErr(keypair2)) {
            t.ok(false, 'keypair 2 is an error');
            t.end();
            return;
        }
        let keypairBytes2 = decodeAuthorKeypairToBytes(keypair);
        if (isErr(keypairBytes2)) {
            t.ok(false, 'keypairBytes2 is an error');
            t.end();
            return;
        };

        t.same(keypair, keypair2, 'keypair encoding/decoding roundtrip matched (strings)');
        t.same(keypairBytes, keypairBytes2, 'keypair encoding/decoding roundtrip matched (bytes)');

        keypair.secret = 'x';
        let err1 = decodeAuthorKeypairToBytes(keypair);
        t.ok(isErr(err1), 'decodeAuthorKeypairToBytes returns an error if the secret is bad base32 (no leading "b")');

        keypair.secret = 'b1';
        let err2 = decodeAuthorKeypairToBytes(keypair);
        t.ok(isErr(err2), 'decodeAuthorKeypairToBytes returns an error if the secret is bad base32 (invalid base32 character)');

        // we test for base32-too-short later in another test

        t.same(driver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  should be ${(driver as any).name}, was ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });

    t.test(SUBTEST_NAME + ': decodeAuthorKeypairToBytes checks Uint8Array length', (t: any) => {
        setGlobalCryptoDriver(driver);

        interface Vector {
            valid: Boolean,
            keypair: AuthorKeypair,
        }
        let vectors: Vector[] = [
            {
                valid: true,
                keypair: {
                    address: '@suzy.b724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a',
                    secret: 'bwgwycyh4gytyw4p2cp55t53wqhbxb7kqnj4assaazroviffuqn7a'
                },
            }, {
                valid: false,
                keypair: {
                    address: '@suzy.b724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a',
                    secret: 'b'  // valid base32 but wrong length
                },
            }, {
                valid: false,
                keypair: {
                    address: '@suzy.b724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a',
                    secret: 'b???'  // invalid base32
                },
            }, {
                valid: false,
                keypair: {
                    address: '@suzy.b724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a',
                    secret: 'baa'  // valid base32 but wrong length
                },
            }, {
                valid: false,
                keypair: {
                    address: '@suzy.b',  // valid base32 but wrong length
                    secret: 'bwgwycyh4gytyw4p2cp55t53wqhbxb7kqnj4assaazroviffuqn7a'
                },
            }, {
                valid: false,
                keypair: {
                    address: '@suzy.b???',  // invalid base32
                    secret: 'bwgwycyh4gytyw4p2cp55t53wqhbxb7kqnj4assaazroviffuqn7a'
                },
            }, {
                valid: false,
                keypair: {
                    address: '@suzy.baa',  // valid base32 but wrong length
                    secret: 'bwgwycyh4gytyw4p2cp55t53wqhbxb7kqnj4assaazroviffuqn7a'
                },
            }, {
                valid: false,
                keypair: {
                    address: '@suzy.724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a', // no b
                    secret: 'bwgwycyh4gytyw4p2cp55t53wqhbxb7kqnj4assaazroviffuqn7a'
                },
            }, {
                valid: false,
                keypair: {
                    address: '@suzy.b724w6da6euw2ip7szpxopq2uodagdyswovh4pqd6ptnanz2u362a',
                    secret: 'wgwycyh4gytyw4p2cp55t53wqhbxb7kqnj4assaazroviffuqn7a'  // no b
                },
            },
        ];

        for (let { valid, keypair } of vectors) {
            let keypairBytesOrErr = decodeAuthorKeypairToBytes(keypair);
            if (valid) {
                t.same(keypairBytesOrErr instanceof ValidationError, false, 'should not be an error: ' + JSON.stringify(keypair));
            } else {
                t.same(keypairBytesOrErr instanceof ValidationError, true, 'should be an error: ' + JSON.stringify(keypair));
            }
        }

        t.same(driver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  should be ${(driver as any).name}, was ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });
}
