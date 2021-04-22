import t = require('tap');
// Boilerplate to help browser-run know when this test is completed (see browser-run.ts)
// When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function..
declare let window: any;
if ((t.test as any).onFinish) {
    (t.test as any).onFinish(() => window.onFinish('crypto-driver-compat'));
}

import { CryptoDriverChloride } from '../crypto/crypto-driver-chloride';
import { CryptoDriverNode } from '../crypto/crypto-driver-node';
import { CryptoDriverTweetnacl } from '../crypto/crypto-driver-tweetnacl';
import { ICryptoDriver, KeypairBytes } from '../crypto/crypto-types';
import { isNode } from 'browser-or-node';
import { identifyBufOrBytes } from '../util/bytes';

let drivers: ICryptoDriver[];
if (isNode) {
    drivers = [
        CryptoDriverChloride,
        CryptoDriverNode,
        CryptoDriverTweetnacl,
    ];
} else {
    drivers = [
        CryptoDriverChloride,
        // CryptoDriverNode,
        CryptoDriverTweetnacl,
    ];
}

t.test('compare sigs from each driver', (t: any) => {
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

t.test('sign with one driver, verify with another', (t: any) => {
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
