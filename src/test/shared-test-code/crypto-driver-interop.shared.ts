import t = require('tap');
import { onFinishOneTest } from '../browser-run-exit';

import {
    ICryptoDriver,
    KeypairBytes
} from '../../crypto/crypto-types';
import {
    identifyBufOrBytes
} from '../../util/bytes';

//================================================================================

export let runCryptoDriverInteropTests = (drivers: ICryptoDriver[]) => {

    let TEST_NAME = 'crypto-driver-interop shared tests';
    let SUBTEST_NAME = drivers.map(driver => (driver as any).name).join(' + ');

    // Boilerplate to help browser-run know when this test is completed.
    // When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function.
    /* istanbul ignore next */ 
    (t.test as any)?.onFinish?.(() => onFinishOneTest(TEST_NAME, SUBTEST_NAME));

    t.test(SUBTEST_NAME + ': compare sigs from each driver', (t: any) => {
        let msg = 'hello';
        let keypairBytes: KeypairBytes = drivers[0].generateKeypairBytes();
        let keypairName = (drivers[0] as any).name;
        let sigs: { name: string, sig: Uint8Array }[] = [];
        for (let signer of drivers) {
            let sig = signer.sign(keypairBytes, msg);
            t.same(identifyBufOrBytes(sig), 'bytes', 'signature is bytes, not buffer');
            sigs.push({ name: (signer as any).name, sig });
        }
        for (let ii = 0; ii < sigs.length-1; ii++) {
            let sigs0 = sigs[ii];
            let sigs1 = sigs[ii+1];
            t.same(sigs0.sig, sigs1.sig, `keypair by ${keypairName}; signature by ${sigs0.name} matches signature by ${sigs1.name}`);
        };
        t.end();
    });

    t.test(SUBTEST_NAME + ': sign with one driver, verify with another', (t: any) => {
        let msg = 'hello';
        for (let signer of drivers) {
            let keypairBytes: KeypairBytes = drivers[0].generateKeypairBytes();
            let sig = signer.sign(keypairBytes, msg);
            let signerName = (signer as any).name;
            for (let verifier of drivers) {
                let verifierName = (verifier as any).name;
                t.ok(verifier.verify(keypairBytes.pubkey, sig, msg), `keypair and signature by ${signerName} was verified by ${verifierName}`);
            }
        }

        t.end();
    });
}