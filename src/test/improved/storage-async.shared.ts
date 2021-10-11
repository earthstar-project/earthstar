import t = require('tap');
import { onFinishOneTest } from '../browser-run-exit';
import { doesNotThrow, throws } from '../test-utils';
//t.runOnly = true;

import { WorkspaceAddress } from '../../util/doc-types';
import { IStorageAsync } from '../../storage/storage-types';
import { isErr } from '../../util/errors';
import { microsecondNow, sleep } from '../../util/misc';
import { Crypto } from '../../crypto/crypto';
import { GlobalCryptoDriver } from '../../crypto/global-crypto-driver';
import { FormatValidatorEs4 } from '../../format-validators/format-validator-es4';
import { StorageAsync } from '../../storage/storage-async';

import { TestScenario } from './test-scenario-types';

//================================================================================

import {
    Logger, LogLevel, setLogLevel,
} from '../../util/log';
let loggerTest = new Logger('test', 'whiteBright');
let loggerTestCb = new Logger('test cb', 'white');
let J = JSON.stringify;
//setLogLevel('test', LogLevel.Debug);

//================================================================================

export let runStorageAsyncTests = (scenario: TestScenario) => {

    let TEST_NAME = 'storage tests';
    let SUBTEST_NAME = scenario.name;

    // Boilerplate to help browser-run know when this test is completed.
    // When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function.
    /* istanbul ignore next */ 
    (t.test as any)?.onFinish?.(() => onFinishOneTest(TEST_NAME, SUBTEST_NAME));

    let makeStorage = (ws: WorkspaceAddress): IStorageAsync => {
        let driver = scenario.makeDriver(ws);
        return new StorageAsync(ws, FormatValidatorEs4, driver);
    }

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
        await storage.close(true);
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
        await throws(t, async () => storage.getMaxLocalIndex(), 'throws after closed');
        await throws(t, async () => await storage.set({} as any, {} as any), 'throws after closed');
        await throws(t, async () => await storage.ingest({} as any), 'throws after closed');
        await throws(t, async () => await storage.overwriteAllDocsByAuthor({} as any), 'throws after closed');

        // TODO: skipping set() and ingest() for now

        await throws(t, async () => await storage.close(false), 'cannot close() twice');
        t.same(storage.isClosed(), true, 'still closed after calling close() twice');

        t.same(events, ['willClose', 'didClose'], 'no more closing events on second call to close()');

        loggerTest.debug('sleeping 50...');
        await sleep(50);
        loggerTest.debug('...done sleeping 50');

        // storage is already closed
        t.same(initialCryptoDriver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  started as ${(initialCryptoDriver as any).name}, ended as ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });

    // TODO: test if erase removes docs (we already tested that it removes config, elsewhere)
    // TODO: test basic writes
    // TODO: test querying

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

        await storage.close(true);
        t.same(initialCryptoDriver, GlobalCryptoDriver, `GlobalCryptoDriver has not changed unexpectedly.  started as ${(initialCryptoDriver as any).name}, ended as ${(GlobalCryptoDriver as any).name}`)
        t.end();
    });

    // TODO: more StorageAsync tests
};
