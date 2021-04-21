import { sleep } from '../util/misc';
import { CryptoDriverChloride as CryptoDriver } from '../crypto/crypto-driver-chloride';
import { runCryptoDriverTests } from './crypto-driver.shared';

let main = async () => {
    runCryptoDriverTests(CryptoDriver);
    //console.log('sleeping');
    //await sleep(2000);
    //runCryptoDriverTests(CryptoDriver);
}
main();
