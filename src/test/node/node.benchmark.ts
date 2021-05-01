import { BenchmarkRunner } from '../shared-benchmark-code/benchmark-runner';

import { IStorageDriverAsync } from '../../storage/storage-types';

import {
    cryptoDrivers_nodeAndUniversal,
    storageDriversAsync_nodeAndUniversal
} from './platform.node';

import { runCryptoDriverBenchmark } from '../shared-benchmark-code/crypto-driver-benchmark.shared';
import { runStorageDriverBenchmark } from '../shared-benchmark-code/storage-driver-benchmark.shared';


let log = console.log;


let main = async () => {
    let runner = new BenchmarkRunner(log);
    for (let cryptoDriver of cryptoDrivers_nodeAndUniversal) {
        await runCryptoDriverBenchmark(runner, cryptoDriver);
    }
    for (let storageDriverClass of storageDriversAsync_nodeAndUniversal) {
        for (let cryptoDriver of cryptoDrivers_nodeAndUniversal) {
            let makeStorageDriver = (): IStorageDriverAsync => {
                return new storageDriverClass();
            }
            let scenarioName = `${storageDriverClass.name} w/ ${(cryptoDriver as any).name}`
            await runStorageDriverBenchmark(runner, cryptoDriver, makeStorageDriver, scenarioName);
        }
    }
}
main();
