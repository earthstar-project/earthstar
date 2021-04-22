import { Crypto } from '../crypto/crypto';
import { CryptoDriverNode as CryptoDriver } from '../crypto/crypto-driver-node';
import { runCryptoDriverTests } from './crypto-driver.shared';
import { runCryptoKeypairTests } from './crypto-keypair.shared';
import { runCryptoTests } from './crypto.shared';

import { isNode } from 'browser-or-node';

// expected platform support: node 12+

if (isNode && process.version >= 'v12') {
    let crypto = new Crypto(CryptoDriver);
    runCryptoDriverTests(CryptoDriver);
    runCryptoKeypairTests(crypto);
    runCryptoTests(crypto);
}
