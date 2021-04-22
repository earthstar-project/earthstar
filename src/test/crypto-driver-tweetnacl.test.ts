import { Crypto } from '../crypto/crypto';
import { CryptoDriverTweetnacl as CryptoDriver } from '../crypto/crypto-driver-tweetnacl';
import { runCryptoDriverTests } from './crypto-driver.shared';
import { runCryptoKeypairTests } from './crypto-keypair.shared';
import { runCryptoTests } from './crypto.shared';

// expected platform support: all

let crypto = new Crypto(CryptoDriver);
runCryptoDriverTests(CryptoDriver);
runCryptoKeypairTests(crypto);
runCryptoTests(crypto);
