import { CryptoDriverChloride as CryptoDriver } from '../crypto/crypto-driver-chloride';
import { runCryptoDriverTests } from './crypto-driver.shared';

import { isNode } from 'browser-or-node';

//if (!isNode) {
    runCryptoDriverTests(CryptoDriver);
//}
