import { runCryptoDriverTests } from '../shared-test-code/crypto-driver.shared';
import { runCryptoKeypairTests } from '../shared-test-code/crypto-keypair.shared';
import { runCryptoTests } from '../shared-test-code/crypto.shared';
import { runCryptoDriverInteropTests } from '../shared-test-code/crypto-driver-interop.shared';

import { cryptoDrivers_nodeAndUniversal } from './platform.node';

for (let cryptoDriver of cryptoDrivers_nodeAndUniversal) {
    runCryptoDriverTests(cryptoDriver);
    runCryptoKeypairTests(cryptoDriver);
    runCryptoTests(cryptoDriver);
}
runCryptoDriverInteropTests(cryptoDrivers_nodeAndUniversal);
