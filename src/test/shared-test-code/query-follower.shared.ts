import t = require('tap');
import { onFinishOneTest } from '../browser-run-exit';

import { WorkspaceAddress } from '../../util/doc-types';
import { Query } from '../../query/query-types';
import { IStorageAsync } from '../../storage/storage-types';

import { isErr } from '../../util/errors';
import { sleep } from '../../util/misc';
import { GlobalCrypto, GlobalCryptoDriver } from '../../crypto/crypto';

import { QueryFollower } from '../../query-follower/query-follower';

//================================================================================

import {
    Logger,
} from '../../util/log';

let loggerTest = new Logger('test', 'whiteBright');
let loggerTestCb = new Logger('test cb', 'white');
let J = JSON.stringify;

//================================================================================

// use this unicode character for testing
let snowmanString = '\u2603';  // ☃ \u2603  [0xe2, 0x98, 0x83] -- 3 bytes
let snowmanBytes = Uint8Array.from([0xe2, 0x98, 0x83]);

//================================================================================

let throws = async (t: any, fn: () => Promise<any>, msg: string) => {
    try {
        await fn();
        t.ok(false, 'failed to throw: ' + msg);
    } catch (err) {
        t.ok(true, msg);
    }
}
let doesNotThrow = async (t: any, fn: () => Promise<any>, msg: string) => {
    try {
        await fn();
        t.ok(true, msg);
    } catch (err) {
        t.ok(false, 'threw but should not have: ' + msg);
    }
}

export let runQueryFollowerTests = (subtestName: string, makeStorage: (ws: WorkspaceAddress) => IStorageAsync) => {

    let TEST_NAME = 'query-follower shared tests';
    let SUBTEST_NAME = subtestName;

    // Boilerplate to help browser-run know when this test is completed.
    // When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function.
    /* istanbul ignore next */ 
    (t.test as any)?.onFinish?.(() => onFinishOneTest(TEST_NAME, SUBTEST_NAME));

    t.test(SUBTEST_NAME + ': query rules', async (t: any) => {
        let initialCryptoDriver = GlobalCryptoDriver;

        let workspace = '+gardening.abcde';
        let storage = makeStorage(workspace);
        let author1 = GlobalCrypto.generateAuthorKeypair('onee');
        if (isErr(author1)) { t.ok(false, 'generate author failed'); await storage.close(); t.end(); return }

        interface Vector { query: Query, isValid: Boolean, note?: string };
        let vectors: Vector[] = [
            { isValid: true,  query: { historyMode: 'all', orderBy: 'localIndex ASC' } },
            { isValid: false, query: { historyMode: 'latest', orderBy: 'localIndex ASC' } },
            { isValid: false, query: { historyMode: 'all', orderBy: 'localIndex DESC' } },
            { isValid: false, query: { historyMode: 'all', orderBy: 'localIndex ASC', limit: 123 } },
            { isValid: false, query: {                     orderBy: 'localIndex ASC' } },
            { isValid: false, query: { historyMode: 'all',                           } },
            { isValid: false, query: {                                               } },

            { isValid: true,  query: { historyMode: 'all', orderBy: 'localIndex ASC', startAfter: { localIndex: 123 }  } },
            { isValid: true,  query: { historyMode: 'all', orderBy: 'localIndex ASC', filter: { path: '/foo/' }  } },
        ];

        for (let { query, isValid, note } of vectors) {
            let makeFollower = async () => {
                let follower = new QueryFollower(storage, query, async () => {});
            };
            if (isValid) { doesNotThrow(t, makeFollower, 'valid:   ' + (note || J(query))); }
            else         { throws(      t, makeFollower, 'invalid: ' + (note || J(query))); }
        }

        await storage.close();
        t.same(initialCryptoDriver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  started as ${(initialCryptoDriver as any).name}, ended as ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });

    t.test(SUBTEST_NAME + ': basics', async (t: any) => {
        let initialCryptoDriver = GlobalCryptoDriver;

        let workspace = '+gardening.abcde';
        let storage = makeStorage(workspace);
        let author1 = GlobalCrypto.generateAuthorKeypair('onee');
        if (isErr(author1)) { t.ok(false, 'generate author failed'); await storage.close(); t.end(); return }
       
        let logs: string[] = [];
        logs.push('-start');

        storage.bus.on('willClose', () => { logs.push('storage willClose'); });
        storage.bus.on('didClose', () => { logs.push('storage didClose'); });

        let follower = new QueryFollower(storage, {
            historyMode: 'all',
            orderBy: 'localIndex ASC',
        }, async (doc) => {
            logs.push(`follower doc: ${doc.path} ${doc.content}`);
        });
        follower.bus.on('close', () => { logs.push('follower close'); });
        follower.bus.on('caught-up', () => { logs.push('follower caught-up'); });
        await follower.hatch();

        await storage.set(author1, { format: 'es.4', path: '/p1', content: '1' });
        await storage.set(author1, { format: 'es.4', path: '/p1', content: '1b' });
        await storage.set(author1, { format: 'es.4', path: '/p2', content: '2' });
        await storage.set(author1, { format: 'es.4', path: '/p2', content: '2b' });

        logs.push('-closing storage');

        await storage.close();
        await sleep(20);

        logs.push('-end');
        t.same(logs, [
            '-start',
            'follower caught-up',
            'follower doc: /p1 1',
            'follower caught-up',
            'follower doc: /p1 1b',
            'follower caught-up',
            'follower doc: /p2 2',
            'follower caught-up',
            'follower doc: /p2 2b',
            'follower caught-up',

            '-closing storage',
            'storage willClose',
            'follower close',
            'storage didClose',
            '-end',
        ], 'logs are as expected');

        t.same(initialCryptoDriver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  started as ${(initialCryptoDriver as any).name}, ended as ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });

    t.test(SUBTEST_NAME + ': delayed start', async (t: any) => {
        let initialCryptoDriver = GlobalCryptoDriver;

        let workspace = '+gardening.abcde';
        let storage = makeStorage(workspace);
        let author1 = GlobalCrypto.generateAuthorKeypair('onee');
        if (isErr(author1)) { t.ok(false, 'generate author failed'); await storage.close(); t.end(); return }
       
        let logs: string[] = [];
        logs.push('-start');

        storage.bus.on('willClose', () => { logs.push('storage willClose'); });
        storage.bus.on('didClose', () => { logs.push('storage didClose'); });


        await storage.set(author1, { format: 'es.4', path: '/p1', content: '1' });
        await storage.set(author1, { format: 'es.4', path: '/p1', content: '1b' });
        await storage.set(author1, { format: 'es.4', path: '/p9', content: '9' });

        let follower = new QueryFollower(storage, {
            historyMode: 'all',
            orderBy: 'localIndex ASC',
        }, async (doc) => {
            logs.push(`follower doc: ${doc.path} ${doc.content}`);
        });
        follower.bus.on('close', () => { logs.push('follower close'); });
        follower.bus.on('caught-up', () => { logs.push('follower caught-up'); });
        await follower.hatch();

        await storage.set(author1, { format: 'es.4', path: '/p2', content: '2' });
        await storage.set(author1, { format: 'es.4', path: '/p2', content: '2b' });

        logs.push('-closing storage');

        await storage.close();
        await sleep(20);

        logs.push('-end');
        t.same(logs, [
            '-start',
            'follower doc: /p1 1b',
            'follower doc: /p9 9',
            'follower caught-up',
            'follower doc: /p2 2',
            'follower caught-up',
            'follower doc: /p2 2b',
            'follower caught-up',

            '-closing storage',
            'storage willClose',
            'follower close',
            'storage didClose',
            '-end',
        ], 'logs are as expected');

        t.same(initialCryptoDriver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  started as ${(initialCryptoDriver as any).name}, ended as ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });

    t.test(SUBTEST_NAME + ': completely delayed start', async (t: any) => {
        let initialCryptoDriver = GlobalCryptoDriver;

        let workspace = '+gardening.abcde';
        let storage = makeStorage(workspace);
        let author1 = GlobalCrypto.generateAuthorKeypair('onee');
        if (isErr(author1)) { t.ok(false, 'generate author failed'); await storage.close(); t.end(); return }
       
        let logs: string[] = [];
        logs.push('-start');

        storage.bus.on('willClose', () => { logs.push('storage willClose'); });
        storage.bus.on('didClose', () => { logs.push('storage didClose'); });


        await storage.set(author1, { format: 'es.4', path: '/p1', content: '1' });
        await storage.set(author1, { format: 'es.4', path: '/p1', content: '1b' });
        await storage.set(author1, { format: 'es.4', path: '/p9', content: '9' });
        await storage.set(author1, { format: 'es.4', path: '/p2', content: '2' });
        await storage.set(author1, { format: 'es.4', path: '/p2', content: '2b' });

        let follower = new QueryFollower(storage, {
            historyMode: 'all',
            orderBy: 'localIndex ASC',
        }, async (doc) => {
            logs.push(`follower doc: ${doc.path} ${doc.content}`);
        });
        follower.bus.on('close', () => { logs.push('follower close'); });
        follower.bus.on('caught-up', () => { logs.push('follower caught-up'); });
        await follower.hatch();

        logs.push('-closing storage');

        await storage.close();
        await sleep(20);

        logs.push('-end');
        t.same(logs, [
            '-start',
            'follower doc: /p1 1b',
            'follower doc: /p9 9',
            'follower doc: /p2 2b',
            'follower caught-up',

            '-closing storage',
            'storage willClose',
            'follower close',
            'storage didClose',
            '-end',
        ], 'logs are as expected');

        t.same(initialCryptoDriver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  started as ${(initialCryptoDriver as any).name}, ended as ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });
};
