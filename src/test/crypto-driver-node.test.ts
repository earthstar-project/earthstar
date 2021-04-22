import { CryptoDriverNode as CryptoDriver } from '../crypto/crypto-driver-node';
import { runCryptoDriverTests } from './crypto-driver.shared';

import { isNode } from 'browser-or-node';

if (isNode) {
    if (process.version >= 'v12') {
        // doesn't work on v10
        runCryptoDriverTests(CryptoDriver);
    }
}
