import { Crypto } from '../crypto/crypto';
import { CryptoDriverChloride as CryptoDriver } from '../crypto/crypto-driver-chloride';
import { runCryptoDriverTests } from './crypto-driver.shared';
import { runCryptoKeypairTests } from './crypto-keypair.shared';
import { runCryptoTests } from './crypto.shared';

// expected platform support: all, but segfaults on node??

import { isNode } from 'browser-or-node';

if (!isNode) {
    let crypto = new Crypto(CryptoDriver);
    runCryptoDriverTests(CryptoDriver);
    runCryptoKeypairTests(crypto);
    runCryptoTests(crypto);
}
