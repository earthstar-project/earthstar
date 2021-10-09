import t from 'tap';
import { onFinishOneTest } from '../browser-run-exit';

import { Lock } from 'concurrency-friends';

import { sleep } from '../../util/misc';

let TEST_NAME = 'lock';

// Boilerplate to help browser-run know when this test is completed.
// When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function.
/* istanbul ignore next */ 
(t.test as any)?.onFinish?.(() => onFinishOneTest(TEST_NAME));

//================================================================================ 

t.test('opts', async (t: any) => {
    let lock = new Lock<any>();

    t.same(await lock.run(async () => {
        return 123;
    }), 123);
    t.same(await lock.run(async () => {
        return 123;
    }, {}), 123);
    t.same(await lock.run(async () => {
        return 123;
    }, { bypass: false }), 123);
    t.same(await lock.run(async () => {
        return 123;
    }, { bypass: true }), 123);

    t.end();
});

t.test('bypass timing', async (t: any) => {
    let lock = new Lock<any>();
    let logs: string[] = ['-start'];

    let prom = lock.run(async () => {
        logs.push('callback-with-bypass');
    }, { bypass: true });

    logs.push('-await');
    await prom;
    logs.push('-end');

    let expectedLogs = [
        '-start',
        '-await',
        'callback-with-bypass',
        '-end',
    ];
    t.same(logs, expectedLogs, 'logs are in expected order');

    t.end();
});

t.test('non-bypass timing', async (t: any) => {
    let lock = new Lock<any>();
    let logs: string[] = ['-start'];

    let prom = lock.run(async () => {
        logs.push('callback');
    });

    logs.push('-await');
    await prom;
    logs.push('-end');

    let expectedLogs = [
        '-start',
        '-await',
        'callback',
        '-end',
    ];
    t.same(logs, expectedLogs, 'logs are in expected order');

    t.end();
});

t.test('bypass run in parallel with normal lock callbacks', async (t: any) => {
    let lock = new Lock<any>();

    let logs: string[] = ['-start'];

    let promA = lock.run(async () => {
        logs.push('a1'); await sleep(30); logs.push('a2'); return 'a';
    });
    let promBypass = lock.run(async () => {
        logs.push('b1'); await sleep(40); logs.push('b2'); return 'b';
    }, { bypass: true });
    let promC = lock.run(async () => {
        logs.push('c1'); await sleep(30); logs.push('c2'); return 'c';
    });

    logs.push('-await');
    let valA = await promA;
    let valB = await promBypass;
    let valC = await promC;
    logs.push('-end');

    let expectedLogs = [
        '-start',
        '-await',
        // a runs
        'a1',
            'b1',  // b ignores the lock and runs while a is running
        'a2',
        // c runs
        'c1', 
            'b2',  // b finishes while c is running
        'c2',
        '-end',
    ];
    t.same(logs, expectedLogs, 'logs are in expected order');
    t.same(valA, 'a', 'value is correct');
    t.same(valB, 'b', 'value is correct from bypass');
    t.same(valC, 'c', 'value is correct');

    t.end();
});


t.test('lock returning a value', async (t: any) => {
    let lock = new Lock<any>();

    let result = await lock.run(async () => {
        return 123;
    });
    t.same(result, 123, 'got expected result back from callback');

    t.end();
});

t.test('lock running in serial with await', async (t: any) => {
    let lock = new Lock<any>();

    let logs: string[] = ['-start'];

    await lock.run(async () => {
        logs.push('1a'); sleep(60); logs.push('1b');
    });
    await lock.run(async () => {
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

t.test('lock trying to run in parallel', async (t: any) => {
    let lock = new Lock<any>();

    let logs: string[] = ['-start'];
    let results: number[] = [];

    let proms = [];
    proms.push(lock.run(async () => {
        logs.push('1a'); sleep(60); logs.push('1b'); return 1;
    }));
    proms.push(lock.run(async () => {
        logs.push('2a'); sleep(60); logs.push('2b'); return 2;
    }));
    logs.push('-first sleep');
    await sleep(50);
    proms.push(lock.run(async () => {
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

t.test('lock recursive', async (t: any) => {
    let lock = new Lock<any>();

    let logs: string[] = ['-start'];

    let proms = [];
    proms.push(lock.run(async () => {
        logs.push('1a'); sleep(60); logs.push('1b');
    }));
    proms.push(lock.run(async () => {
        // This is not really a true recursive lock.
        // We're just making a new Lock inside the run function of another Lock
        let innerLock = new Lock();
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
    proms.push(lock.run(async () => {
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

t.test('lock error handling', async (t: any) => {
    let lock = new Lock<any>();

    try {
        await lock.run(async () => {
            throw new Error('kaboom');
        });
        t.ok(false, 'error was not caught');
    } catch (err: any) {
        t.ok(true, 'error was caught');
        t.same(err.message, 'kaboom', 'it was the same error');
    }

    try {
        await lock.run(async () => {
            throw new Error('kaboom');
        }, { bypass: true });
        t.ok(false, 'error was not caught with bypass');
    } catch (err: any) {
        t.ok(true, 'error was caught with bypass');
        t.same(err.message, 'kaboom', 'it was the same error');
    }

    t.end();
});
