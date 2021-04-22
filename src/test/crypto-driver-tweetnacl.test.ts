import { CryptoDriverTweetnacl as CryptoDriver } from '../crypto/crypto-driver-tweetnacl';
import { runCryptoDriverTests } from './crypto-driver.shared';

runCryptoDriverTests(CryptoDriver);
