import { BenchmarkRunner } from "../shared-benchmark-code/benchmark-runner.ts";

import { cryptoDrivers_browserAndUniversal } from "./platform.browser.ts";
import { runCryptoDriverBenchmark } from "../shared-benchmark-code/crypto-driver-benchmark.shared.ts";
import { sleep } from "../../util/misc.ts";

let log = console.log;

let main = async () => {
  let runner = new BenchmarkRunner(log);
  for (let cryptoDriver of cryptoDrivers_browserAndUniversal) {
    let driverName = (cryptoDriver as any).name;
    if (driverName === "CryptoDriverChloride") {
      // special case for chloride, to give it a chance to load the WASM version
      await runCryptoDriverBenchmark(runner, cryptoDriver, "(without waiting)");
      await sleep(3000);
      await runCryptoDriverBenchmark(runner, cryptoDriver, "(after waiting)");
    } else {
      // run as normal
      await runCryptoDriverBenchmark(runner, cryptoDriver);
    }
  }
  window.close();
};
main();
