import { BenchmarkRunner } from '../shared-benchmark-code/benchmark-runner';

import { IStorageDriverAsync } from '../../storage/storage-types';

import {
    cryptoDrivers_nodeAndUniversal,
    storageDriversAsync_nodeAndUniversal
} from './platform.node';

import { runCryptoDriverBenchmark } from '../shared-benchmark-code/crypto-driver-benchmark.shared';
import { runStorageDriverBenchmark } from '../shared-benchmark-code/storage-driver-benchmark.shared';
import { CryptoDriverFake } from '../../crypto/crypto-driver-fake';

let log = console.log;

let main = async () => {
    let runner = new BenchmarkRunner(log);
    let cryptoDrivers = [CryptoDriverFake].concat(cryptoDrivers_nodeAndUniversal);
    for (let cryptoDriver of cryptoDrivers) {
        await runCryptoDriverBenchmark(runner, cryptoDriver);
    }
    for (let storageDriverClass of storageDriversAsync_nodeAndUniversal) {
        for (let cryptoDriver of cryptoDrivers) {
            let makeStorageDriver = (): IStorageDriverAsync => {
                return new storageDriverClass();
            }
            let scenarioName = `${storageDriverClass.name} w/ ${(cryptoDriver as any).name}`
            await runStorageDriverBenchmark(runner, cryptoDriver, makeStorageDriver, scenarioName);
        }
    }
}
main();
