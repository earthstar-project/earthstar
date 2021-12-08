import t = require('tap');
import { onFinishOneTest } from '../browser-run-exit';
import { snowmanString, snowmanBytes } from '../test-utils';
//t.runOnly = true;

import {
    identifyBufOrBytes,
    stringToBytes
} from '../../util/bytes';
import {
    stringToBuffer,
} from '../../util/buffers';
import {
    base32StringToBytes
} from '../../crypto/base32';
import {
    ICryptoDriver
} from '../../crypto/crypto-types';

//================================================================================

export let runCryptoDriverTests = (driver: ICryptoDriver) => {

    let TEST_NAME = 'crypto-driver shared tests';
    let SUBTEST_NAME = (driver as any).name;

    // Boilerplate to help browser-run know when this test is completed.
    // When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function.
    /* istanbul ignore next */ 
    (t.test as any)?.onFinish?.(() => onFinishOneTest(TEST_NAME, SUBTEST_NAME));

    t.test(SUBTEST_NAME + ': sha256(bytes | string) --> bytes', async (t: any) => {
        let vectors : [Uint8Array | string | Buffer, Uint8Array][] = [
            // input, output
            ['', base32StringToBytes('b4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq')],
            [stringToBytes(''), base32StringToBytes('b4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq')],
            ['abc', base32StringToBytes('bxj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq')],
            [stringToBytes('abc'), base32StringToBytes('bxj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq')],
            [snowmanString, base32StringToBytes('bkfsdgyoht3fo6jni32ac3yspk4f2exm4fxy5elmu7lpbdnhum3ga')],
            [snowmanBytes, base32StringToBytes('bkfsdgyoht3fo6jni32ac3yspk4f2exm4fxy5elmu7lpbdnhum3ga')],

            // we're not supposed to feed it Buffers but let's find out what happens when we do.
            [stringToBuffer('abc'), base32StringToBytes('bxj4bnp4pahh6uqkbidpf3lrceoyagyndsylxvhfucd7wd4qacwwq')],
            [stringToBuffer(''), base32StringToBytes('b4oymiquy7qobjgx36tejs35zeqt24qpemsnzgtfeswmrw6csxbkq')],
            [stringToBuffer(snowmanString), base32StringToBytes('bkfsdgyoht3fo6jni32ac3yspk4f2exm4fxy5elmu7lpbdnhum3ga')],
        ];
        for (let [input, expectedResult] of vectors) {
            let actualResult = await driver.sha256(input);
            t.same(identifyBufOrBytes(actualResult), 'bytes', 'sha256 outputs bytes');
            t.same(actualResult.length, 32, 'sha256 outputs 32 bytes');
            t.same(actualResult, expectedResult, `hash of bytes or string: ${JSON.stringify(input)}`)
        }
        t.end();
    });

    t.test(SUBTEST_NAME + ': generateKeypairBytes', async (t: any) => {
        let keypair = await driver.generateKeypairBytes();
        t.same(identifyBufOrBytes(keypair.pubkey), 'bytes', 'keypair.pubkey is bytes');
        t.same(identifyBufOrBytes(keypair.secret), 'bytes', 'keypair.secret is bytes');
        t.same(keypair.pubkey.length, 32, 'pubkey is 32 bytes long');
        t.same(keypair.secret.length, 32, 'secret is 32 bytes long');
        t.notSame(keypair.secret, keypair.pubkey, 'secret is !== pubkey');

        let keypair2 = await driver.generateKeypairBytes();
        t.notSame(keypair.pubkey, keypair2.pubkey, 'generateKeypairBytes is non-deterministic (pubkey)');
        t.notSame(keypair.secret, keypair2.secret, 'generateKeypairBytes is non-deterministic (secret)');

        t.end();
    });

    t.test(SUBTEST_NAME + ': sign and verify', async (t: any) => {
        let keypairBytes = await driver.generateKeypairBytes();
        let msg = 'hello'
        let sigBytes = await driver.sign(keypairBytes, msg);

        t.same(identifyBufOrBytes(sigBytes), 'bytes', 'signature is bytes, not buffer');
        t.same(sigBytes.length, 64, 'sig is 64 bytes long');

        t.ok(await driver.verify(keypairBytes.pubkey, sigBytes, msg), 'signature is valid');

        t.notOk(await driver.verify(keypairBytes.pubkey, sigBytes, msg+'!'), 'signature is invalid after message is changed');

        // change the sig and see if it's still valid
        sigBytes[0] = (sigBytes[0] + 1) % 256;
        t.notOk(await driver.verify(keypairBytes.pubkey, sigBytes, msg), 'signature is invalid after signature is changed');

        t.end();
    });

}
