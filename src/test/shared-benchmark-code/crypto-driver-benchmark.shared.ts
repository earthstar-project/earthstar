import {
    isErr
} from '../../util/errors';
import {
    ICryptoDriver,
    KeypairBytes
} from '../../crypto/crypto-types';
import { randomId } from '../../util/misc';

import {
    BenchmarkRunner
} from './benchmark-runner';

//================================================================================

export let runCryptoDriverBenchmark = async (runner: BenchmarkRunner, cryptoDriver: ICryptoDriver, notes?: string) => {
    let driverName = (cryptoDriver as any).name;
    runner.setScenario(`${driverName} ${notes || ''}`);

    //==================================================
    // setup

    let keypairBytes = cryptoDriver.generateKeypairBytes() as KeypairBytes;
    if (isErr(keypairBytes)) { console.warn(keypairBytes); }

    let msgToSign = 'hello' + randomId() + randomId();
    let sigBytes = cryptoDriver.sign(keypairBytes, msgToSign);

    //==================================================
    // benchmarks

    await runner.runMany('sha256', {minDuration: 1234}, async () => {
        let msgToHash = 'hello' + randomId() + randomId();
        cryptoDriver.sha256(msgToHash);
    });

    await runner.runMany('generateAuthorKeypair', {minDuration: 1234}, async () => {
        let thisKeypair = cryptoDriver.generateKeypairBytes();
        if (isErr(thisKeypair)) { console.warn(thisKeypair); }
    });

    await runner.runMany('sign', {minDuration: 1234}, async () => {
        cryptoDriver.sign(keypairBytes, msgToSign);
    });

    await runner.runMany('validate', {minDuration: 1234}, async () => {
        cryptoDriver.verify(keypairBytes.pubkey, sigBytes, msgToSign);
    });

    //==================================================
    // teardown
}
