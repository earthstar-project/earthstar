import { Crypto } from '../../crypto/crypto';

import { runCryptoDriverTests } from '../shared-test-code/crypto-driver.shared';
import { runCryptoKeypairTests } from '../shared-test-code/crypto-keypair.shared';
import { runCryptoTests } from '../shared-test-code/crypto.shared';
import { runCryptoDriverInteropTests } from '../shared-test-code/crypto-driver-interop.shared';

import { cryptoDrivers_browserAndUniversal } from './platform.browser';

for (let cryptoDriver of cryptoDrivers_browserAndUniversal) {
    let crypto = new Crypto(cryptoDriver);
    runCryptoDriverTests(cryptoDriver);
    runCryptoKeypairTests(crypto);
    runCryptoTests(crypto);
}
runCryptoDriverInteropTests(cryptoDrivers_browserAndUniversal);
