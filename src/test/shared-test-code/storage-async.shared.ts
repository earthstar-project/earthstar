import t = require('tap');
import { onFinishOneTest } from '../browser-run-exit';
import { doesNotThrow, throws } from '../test-utils';
//t.runOnly = true;

import {
    WorkspaceAddress,
} from '../../util/doc-types';
import {
    IStorageAsync, LiveQueryEvent,
} from '../../storage/storage-types';
import {
    isErr,
} from '../../util/errors';
import {
    microsecondNow, sleep,
} from '../../util/misc';
import { Crypto } from '../../crypto/crypto';
import { GlobalCryptoDriver } from '../../crypto/global-crypto-driver';

//================================================================================

import {
    Logger, LogLevel, setLogLevel,
} from '../../util/log';
import { Query } from '../../query/query-types';

let loggerTest = new Logger('test', 'whiteBright');
let loggerTestCb = new Logger('test cb', 'white');
let J = JSON.stringify;

//setLogLevel('test', LogLevel.Debug);

//================================================================================

export let runStorageTests = (subtestName: string, makeStorage: (ws: WorkspaceAddress) => IStorageAsync) => {

    let TEST_NAME = 'storage shared tests';
    let SUBTEST_NAME = subtestName;

    // Boilerplate to help browser-run know when this test is completed.
    // When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function.
    /* istanbul ignore next */ 
    (t.test as any)?.onFinish?.(() => onFinishOneTest(TEST_NAME, SUBTEST_NAME));

    t.test(SUBTEST_NAME + ': config', async (t: any) => {
        let initialCryptoDriver = GlobalCryptoDriver;

        let workspace = '+gardening.abcde';
        let storage = makeStorage(workspace);

        // empty...
        t.same(await storage.getConfig('foo'), undefined, `getConfig('nonexistent') --> undefined`);
        t.same(await storage.listConfigKeys(), [], `listConfigKeys() is []`);
        t.same(await storage.deleteConfig('foo'), false, `deleteConfig('nonexistent') --> false`);

        // set some items...
        await storage.setConfig('b', 'bb');
        await storage.setConfig('a', 'aa');

        // after adding some items...
        t.same(await storage.getConfig('a'), 'aa', `getConfig works`);
        t.same(await storage.listConfigKeys(), ['a', 'b'], `listConfigKeys() is ['a', 'b'] (sorted)`);

        t.same(await storage.deleteConfig('a'), true, 'delete returns true on success');
        t.same(await storage.deleteConfig('a'), false, 'delete returns false if nothing is there');
        t.same(await storage.getConfig('a'), undefined, `getConfig returns undefined after deleting the key`);

        await storage.close();
        t.same(initialCryptoDriver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  started as ${(initialCryptoDriver as any).name}, ended as ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });

    t.test(SUBTEST_NAME + ': storage close() and throwing when closed', async (t: any) => {
        let initialCryptoDriver = GlobalCryptoDriver;

        let workspace = '+gardening.abcde';
        let storage = makeStorage(workspace);
        let events: string[] = [];

        t.same(typeof storage.storageId, 'string', 'storage has a storageId');

        // subscribe in a different order than they will normally happen,
        // to make sure they really happen in the right order when they happen for real
        storage.bus.on('didClose', (channel, data) => {
            loggerTestCb.debug('>> didClose event handler');
            events.push(channel);
        });
        storage.bus.on('willClose', (channel, data) => {
            loggerTestCb.debug('>> willClose event handler');
            events.push(channel);
        });

        t.same(storage.isClosed(), false, 'is not initially closed');
        await doesNotThrow(t, async () => storage.isClosed(), 'isClosed does not throw');
        await doesNotThrow(t, async () => await storage.getDocsAfterLocalIndex('all', 0, 1), 'does not throw because not closed');
        await doesNotThrow(t, async () => await storage.getAllDocs(), 'does not throw because not closed');
        await doesNotThrow(t, async () => await storage.getLatestDocs(), 'does not throw because not closed');
        await doesNotThrow(t, async () => await storage.getAllDocsAtPath('/a'), 'does not throw because not closed');
        await doesNotThrow(t, async () => await storage.getLatestDocAtPath('/a'), 'does not throw because not closed');
        await doesNotThrow(t, async () => await storage.queryDocs(), 'does not throw because not closed');
        t.same(events, [], 'no events yet');

        loggerTest.debug('launching microtask, nextTick, and setTimeout');
        queueMicrotask(() => loggerTestCb.debug('--- microtask ---'));
        process.nextTick(() => loggerTestCb.debug('--- nextTick ---'));
        setTimeout(() => loggerTestCb.debug('--- setTimeout 0 ---'), 0);

        loggerTest.debug('closing...');
        await storage.close();
        loggerTest.debug('...done closing');

        // wait for didClose to happen on setTimeout
        await sleep(20);

        t.same(events, ['willClose', 'didClose'], 'closing events happened');

        t.same(storage.isClosed(), true, 'is closed after close()');

        await doesNotThrow(t, async () => storage.isClosed(), 'isClosed does not throw');
        await throws(t, async () => await storage.getDocsAfterLocalIndex('all', 0, 1), 'throws after closed');
        await throws(t, async () => await storage.getAllDocs(), 'throws after closed');
        await throws(t, async () => await storage.getLatestDocs(), 'throws after closed');
        await throws(t, async () => await storage.getAllDocsAtPath('/a'), 'throws after closed');
        await throws(t, async () => await storage.getLatestDocAtPath('/a'), 'throws after closed');
        await throws(t, async () => await storage.queryDocs(), 'throws after closed');

        // TODO: skipping set() and ingest() for now

        await doesNotThrow(t, async () => await storage.close(), 'can close() twice');
        t.same(storage.isClosed(), true, 'still closed after calling close() twice');

        t.same(events, ['willClose', 'didClose'], 'no more closing events on second call to close()');

        loggerTest.debug('sleeping 50...');
        await sleep(50);
        loggerTest.debug('...done sleeping 50');

        // storage is already closed
        t.same(initialCryptoDriver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  started as ${(initialCryptoDriver as any).name}, ended as ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });

    t.test(SUBTEST_NAME + ': storage destroy() and close()', async (t: any) => {
        let initialCryptoDriver = GlobalCryptoDriver;

        let workspace = '+gardening.abcde';
        let storage = makeStorage(workspace);

        t.same(typeof storage.storageId, 'string', 'storage has a storageId');

        t.same(storage.isClosed(), false, 'is not initially closed');
        await doesNotThrow(t, async () => storage.isClosed(), 'isClosed does not throw');

        loggerTest.debug('destroying...');
        await storage.destroy();
        loggerTest.debug('...done destroying');

        t.same(storage.isClosed(), false, 'is not closed after destroy()');

        await doesNotThrow(t, async () => await storage.close(), 'can close() twice');
        await doesNotThrow(t, async () => await storage.close(), 'can close() twice');
        t.same(storage.isClosed(), true, 'still closed after calling close() twice');

        await throws(t, async () => await storage.destroy(), 'cannot destroy after closing');

        // storage is already closed
        t.same(initialCryptoDriver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  started as ${(initialCryptoDriver as any).name}, ended as ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });

    t.test(SUBTEST_NAME + ': storage overwriteAllDocsByAuthor', async (t: any) => {
        let initialCryptoDriver = GlobalCryptoDriver;

        let workspace = '+gardening.abcde';
        let storage = makeStorage(workspace);

        let keypair1 = Crypto.generateAuthorKeypair('aaaa');
        let keypair2 = Crypto.generateAuthorKeypair('bbbb');
        if (isErr(keypair1) || isErr(keypair2)) {
            t.ok(false, 'error making keypair');
            t.end();
            return;
        }

        let now = microsecondNow();
        await storage.set(keypair1, {
            format: 'es.4',
            path: '/pathA',
            content: 'content1',
            timestamp: now,
        });
        await storage.set(keypair2, {
            format: 'es.4',
            path: '/pathA',
            content: 'content2',
            timestamp: now + 3, // latest
        });

        await storage.set(keypair2, {
            format: 'es.4',
            path: '/pathB',
            content: 'content2',
            timestamp: now,
        });
        await storage.set(keypair1, {
            format: 'es.4',
            path: '/pathB',
            content: 'content1',
            timestamp: now + 3, // latest
        });

        // history of each path, latest doc first:
        //   /pathA: keypair2, keypair1
        //   /pathB: keypair1, keypair2

        //--------------------------------------------
        // check everything is as expected before we do the overwriteAll

        t.same((await storage.getAllDocs()).length, 4, 'should have 4 docs including history');
        t.same((await storage.getLatestDocs()).length, 2, 'should have 2 latest-docs');

        let docsA = await storage.getAllDocsAtPath('/pathA');  // latest first
        let docsA_actualAuthorAndContent = docsA.map(doc => [doc.author, doc.content]);
        let docsA_expectedAuthorAndContent: [string, string][] = [
            [keypair2.address, 'content2'],  // latest first
            [keypair1.address, 'content1'],
        ];
        t.same(docsA.length, 2, 'two docs found at /pathA (including history)');
        t.ok(docsA[0].timestamp > docsA[1].timestamp, 'docs are ordered latest first within this path');
        t.same(docsA_actualAuthorAndContent, docsA_expectedAuthorAndContent, '/pathA docs are as expected');

        let docsB = await storage.getAllDocsAtPath('/pathB');  // latest first
        let docsB_actualAuthorAndContent = docsB.map(doc => [doc.author, doc.content]);
        let docsB_expectedAuthorAndContent: [string, string][] = [
            [keypair1.address, 'content1'],  // latest first
            [keypair2.address, 'content2'],
        ];
        t.same(docsB.length, 2, 'two docs found at /pathB (including history)');
        t.ok(docsB[0].timestamp > docsB[1].timestamp, 'docs are ordered latest first within this path');
        t.same(docsB_actualAuthorAndContent, docsB_expectedAuthorAndContent, '/pathB docs are as expected');

        //--------------------------------------------
        // overwrite
        let result = await storage.overwriteAllDocsByAuthor(keypair1);
        t.same(result, 2, 'two docs were overwritten');

        //--------------------------------------------
        // look for results

        t.same((await storage.getAllDocs()).length, 4, 'after overwriting, should still have 4 docs including history');
        t.same((await storage.getLatestDocs()).length, 2, 'after overwriting, should still have 2 latest-docs');

        docsA = await storage.getAllDocsAtPath('/pathA');  // latest first
        docsA_actualAuthorAndContent = docsA.map(doc => [doc.author, doc.content]);
        docsA_expectedAuthorAndContent = [
            [keypair2.address, 'content2'],  // latest first
            [keypair1.address, ''],
        ];
        t.same(docsA.length, 2, 'two docs found at /pathA (including history)');
        t.ok(docsA[0].timestamp > docsA[1].timestamp, 'docs are ordered latest first within this path');
        t.same(docsA_actualAuthorAndContent, docsA_expectedAuthorAndContent, '/pathA docs are as expected');

        docsB = await storage.getAllDocsAtPath('/pathB');  // latest first
        docsB_actualAuthorAndContent = docsB.map(doc => [doc.author, doc.content]);
        docsB_expectedAuthorAndContent = [
            [keypair1.address, ''],  // latest first
            [keypair2.address, 'content2'],
        ];
        t.same(docsB.length, 2, 'two docs found at /pathB (including history)');
        t.ok(docsB[0].timestamp > docsB[1].timestamp, 'docs are ordered latest first within this path');
        t.same(docsB_actualAuthorAndContent, docsB_expectedAuthorAndContent, '/pathB docs are as expected');

        await storage.close();
        t.same(initialCryptoDriver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  started as ${(initialCryptoDriver as any).name}, ended as ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });

    t.test(SUBTEST_NAME + ': storage liveQuery', async (t: any) => {
        let initialCryptoDriver = GlobalCryptoDriver;

        loggerTest.debug('begin');

        let logs: string[] = ['-begin'];

        let workspace = '+gardening.abcde';
        let storage = makeStorage(workspace);

        let keypair1 = Crypto.generateAuthorKeypair('aaaa');
        let keypair2 = Crypto.generateAuthorKeypair('bbbb');
        if (isErr(keypair1) || isErr(keypair2)) {
            t.ok(false, 'error making keypair');
            t.end();
            return;
        }

        let now = microsecondNow();
        loggerTest.debug('write doc 0');
        await storage.set(keypair1, {
            format: 'es.4',
            path: '/apple',
            content: 'crunchy0',
            timestamp: now + 0,
        });

        loggerTest.debug('write doc 1');
        await storage.set(keypair1, {
            format: 'es.4',
            path: '/cherry',
            content: 'crispy1',
            timestamp: now + 1,
        });

        loggerTest.debug('starting live query');
        let query: Query = {
            historyMode: 'all',
            orderBy: 'localIndex ASC',
            //filter: { path: '/apple' },
            startAfter: { localIndex: -1 }, // start at beginning
        }
        storage.liveQuery(query, async (event: LiveQueryEvent) => {
            loggerTestCb.debug('>>>>>>>>>>>>>>>>', event);
            if (event.kind && event.kind === 'existing') {
                logs.push(`${event.kind}: ${event.doc.path} index ${event.doc._localIndex}`);
            } else if (event.kind && event.kind === 'success') {
                logs.push(`${event.kind}: ${event.doc.path} index ${event.doc._localIndex}`);
            } else if (event.kind) {
                logs.push(`${event.kind}`);
            } else {
                logs.push(`???`);
            }
        });

        loggerTest.debug('write doc 2');
        await storage.set(keypair2, {
            format: 'es.4',
            path: '/apple',
            content: 'juicy2',
            timestamp: now + 2,
        });

        loggerTest.debug('write doc 3');
        await storage.set(keypair2, {
            format: 'es.4',
            path: '/banana',
            content: 'yellow3',
            timestamp: now + 3,
        });

        loggerTest.debug('sleep so live query can catch up');
        await sleep(10);

        loggerTest.debug('write doc 4');
        await storage.set(keypair2, {
            format: 'es.4',
            path: '/peach',
            content: 'orange4',
            timestamp: now + 4,
        });

        loggerTest.debug('sleep so live query can catch up');
        await sleep(10);

        loggerTest.debug('close');
        await storage.close();

        await sleep(100);
        logs.push('-end');
        let expectedLogs = [
            '-begin',
            'existing: /apple index 0',
            'existing: /cherry index 1',
            'existing: /apple index 2',
            'existing: /banana index 3',
            'success: /peach index 4',
            'willClose',
            'didClose',
            '-end',
        ];
        t.same(logs, expectedLogs, 'logs match');

        t.same(initialCryptoDriver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  started as ${(initialCryptoDriver as any).name}, ended as ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });


    // TODO: more StorageAsync tests
};
