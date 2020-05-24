import { sleep } from './util';
import { Lock } from './lock';

let log = console.log;

let slowDouble = async (n : number, delay : number = 1000) => {
    await sleep(delay);
    return n * 2;
}
let slowLog = async (x : any, delay : number) : Promise<void> => {
    log('... a' + x);
    await sleep(delay / 2);
    log('... ... b' + x);
    await sleep(delay / 2);
    log('... ... ... c' + x);
}

let test = async () => {
    let lock = new Lock();

    log('crash test');
    try {
        await lock.whenFree(async () => {
            log('  lock about to crash');
            await sleep(1000);
            throw "oops";
            log('  lock crashed');
        });
    } catch (e) {
        log('  caught error');
        log('............', e);
    }
    log('crash test: done');

    log('                        locked: ', lock._locked);

    log('awaiting whenFree sleep');
    log('             before     locked: ', lock._locked);
    await lock.whenFree(async () => {
        log('             during     locked: ', lock._locked);
        await sleep(1000);
        log('             during     locked: ', lock._locked);
    });
    log('             after      locked: ', lock._locked);

    log('awaiting whenFree immediate number');
    let num1 = await lock.whenFree(async () => {
        return 3;
    });
    log(num1);

    log('awaiting whenFree number');
    let num2 = await lock.whenFree(async () => {
        return await slowDouble(5, 1000);
    });
    log(num2);

    log('awaiting lockified number');
    let lockifiedGetNum = lock.lockify(slowDouble);
    let num3 = await lockifiedGetNum(7, 1000);
    log(num3);

    await sleep(500);

    log('---------------------------------------');
    log('starting parallel test');

    let slowLog2 = lock.lockify(slowLog);

    let proms : Promise<void>[] = [];
    log('creating promises');
    for (let ii = 0; ii < 5; ii++) {
        log('                        locked: ', lock._locked);
        //proms.push(slowLog2('' + ii, 1000));
        proms.push(lock.whenFree(() => slowLog('' + ii, 1000)));
    }
    log('awaiting promises');
    for (let p of proms) {
        log('                        locked: ', lock._locked);
        await p;
    }
    log('                        locked: ', lock._locked);
    log('parallel test complete');
    log('---------------------------------------');

    log('                        locked: ', lock._locked);
}
test();