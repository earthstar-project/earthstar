import t from 'tap';
import { onFinishOneTest } from '../browser-run-exit';
import { RLock } from '../../storage/rlock';
import { sleep } from '../../util/misc';
import { LogLevel } from '../../util/log';

let TEST_NAME = 'rlock';

// Boilerplate to help browser-run know when this test is completed.
// When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function.
/* istanbul ignore next */ 
(t.test as any)?.onFinish?.(() => onFinishOneTest(TEST_NAME));

//================================================================================ 

t.test('rlock returning a value', async (t: any) => {
    let rlock = new RLock<any>();

    let result = await rlock.run(async () => {
        return 123;
    });
    t.same(result, 123, 'got expected result back from callback');

    t.end();
});

t.test('rlock running in serial with await', async (t: any) => {
    let rlock = new RLock<any>();

    let logs: string[] = ['-start'];

    await rlock.run(async () => {
        logs.push('1a'); sleep(60); logs.push('1b');
    });
    await rlock.run(async () => {
        logs.push('2a'); sleep(60); logs.push('2b');
    });

    logs.push('-end');

    let expectedLogs = [
        '-start',
        '1a',
        '1b',
        '2a',
        '2b',
        '-end',
    ];
    t.same(logs, expectedLogs, 'logs are in expected order');

    t.end();
});

t.test('rlock trying to run in parallel', async (t: any) => {
    let rlock = new RLock<any>();

    let logs: string[] = ['-start'];
    let results: number[] = [];

    let proms = [];
    proms.push(rlock.run(async () => {
        logs.push('1a'); sleep(60); logs.push('1b'); return 1;
    }));
    proms.push(rlock.run(async () => {
        logs.push('2a'); sleep(60); logs.push('2b'); return 2;
    }));
    logs.push('-first sleep');
    await sleep(50);
    proms.push(rlock.run(async () => {
        logs.push('3a'); sleep(60); logs.push('3b'); return 3;
    }));

    for (let prom of proms) {
        results.push(await prom);
    }

    logs.push('-end');

    let expectedLogs = [
        '-start',
        '-first sleep',
        '1a',
        '1b',
        '2a',
        '2b',
        '3a',
        '3b',
        '-end',
    ];
    t.same(logs, expectedLogs, 'logs are in expected order');
    t.same(results, [1, 2, 3], 'results are in expected order');

    t.end();
});

t.test('rlock recursive', async (t: any) => {
    let rlock = new RLock<any>();

    let logs: string[] = ['-start'];

    let proms = [];
    proms.push(rlock.run(async () => {
        logs.push('1a'); sleep(60); logs.push('1b');
    }));
    proms.push(rlock.run(async (innerLock) => {
        logs.push('2a');
        sleep(10);

        let innerProms = [];
        innerProms.push(innerLock.run(async () => {
            logs.push('2a-1a'); sleep(60); logs.push('2a-1b');
        }));
        innerProms.push(innerLock.run(async () => {
            logs.push('2a-2a'); sleep(60); logs.push('2a-2b');
        }));
        innerProms.push(innerLock.run(async () => {
            logs.push('2a-3a'); sleep(60); logs.push('2a-3b');
        }));
        logs.push('2a-promise.all');
        await Promise.all(innerProms);

        sleep(10);
        logs.push('2b');
    }));
    proms.push(rlock.run(async () => {
        logs.push('3a'); sleep(60); logs.push('3b');
    }));

    logs.push('-promise.all');
    await Promise.all(proms);
    logs.push('-end');

    let expectedLogs = [
        '-start',
        '-promise.all',
        '1a',
        '1b',
        '2a',
        '2a-promise.all',
        '2a-1a',
        '2a-1b',
        '2a-2a',
        '2a-2b',
        '2a-3a',
        '2a-3b',
        '2b',
        '3a',
        '3b',
        '-end',
    ];
    t.same(logs, expectedLogs, 'logs are in expected order');

    t.end();
});

// TODO: error handling
