import t = require('tap');
//t.runOnly = true;

import {
    Bus,
} from '../util/bus';
import {
    sleep
} from '../util/helpers';

interface Channels {
    s: string,
    n: number,
    '*': string | number,
}
t.test('bus sync', async (t: any) => {
    let bus = new Bus<Channels>();
    let logs: string[] = [];
    let unsub1 = bus.subscribe('s', (s) => { logs.push('s1:' + s); });
    let unsub4 = bus.subscribe('*', (x) => { logs.push('*:' + x); });  // '*' will always run last
    let unsub2 = bus.subscribe('s', (s) => { logs.push('s2:' + s); });
    let unsub3 = bus.subscribe('n', (n) => { logs.push('n1:' + n); });

    bus.send('s', 'a');
    bus.send('n', 100);
    bus.send('no-such' as any, 777);  // unknown channel should trigger the '*' callback
    bus.send('*' as any, 888);  // send to '*' will only trigger '*'

    let expectedLogs = ['s1:a', 's2:a', '*:a', 'n1:100', '*:100', '*:777', '*:888'];
    t.same(logs, expectedLogs, 'subscriptions ran in expected order and respected channel names');

    unsub1();
    unsub2();
    bus.unsubscribeAll();

    bus.send('s', 'x');
    bus.send('n', 999);

    t.same(logs, expectedLogs, 'unsub works');

    t.end();
});

t.test('bus async', async (t: any) => {
    let bus = new Bus<Record<string, string>>();

    let logs: string[] = [];

    let unsub1 = bus.subscribe('ch1', async (s) => {
        logs.push(`${s} cb begin 1`);
        sleep(100);
        logs.push(`${s} cb end 1`);
    });
    let unsub2 = bus.subscribe('ch1', async (s) => {
        logs.push(`${s} cb begin 2`);
        sleep(100);
        logs.push(`${s} cb end 2`);
    });

    logs.push(`a before send`);
    await bus.send('ch1', 'a');
    logs.push(`a after send`);

    t.same(logs, ['a before send', 'a cb begin 1', 'a cb end 1', 'a cb begin 2', 'a cb end 2', 'a after send'], 'send waits for cb to finish');

    t.end();
});