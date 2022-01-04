import { runCryptoDriverTests } from "../shared-test-code/crypto-driver.shared.ts";
import { runCryptoKeypairTests } from "../shared-test-code/crypto-keypair.shared.ts";
import { runCryptoTests } from "../shared-test-code/crypto.shared.ts";
import { runCryptoDriverInteropTests } from "../shared-test-code/crypto-driver-interop.shared.ts";

import { cryptoDrivers_browserAndUniversal } from "./platform.browser.ts";

for (let cryptoDriver of cryptoDrivers_browserAndUniversal) {
  runCryptoDriverTests(cryptoDriver);
  runCryptoKeypairTests(cryptoDriver);
  runCryptoTests(cryptoDriver);
}
runCryptoDriverInteropTests(cryptoDrivers_browserAndUniversal);
