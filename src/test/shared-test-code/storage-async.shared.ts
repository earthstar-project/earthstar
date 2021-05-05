import t = require('tap');

import {
    WorkspaceAddress,
} from '../../util/doc-types';
import {
    IStorageAsync,
} from '../../storage/storage-types';
import {
    isErr,
} from '../../util/errors';
import {
    microsecondNow, sleep,
} from '../../util/misc';

//================================================================================

import {
    Logger,
} from '../../util/log';

let loggerTest = new Logger('test', 'whiteBright');
let loggerTestCb = new Logger('test cb', 'white');

//================================================================================

// use this unicode character for testing
let snowmanString = '\u2603';  // ☃ \u2603  [0xe2, 0x98, 0x83] -- 3 bytes
let snowmanBytes = Uint8Array.from([0xe2, 0x98, 0x83]);

//================================================================================

let J = JSON.stringify;

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

export let runStorageTests = (description: string, makeStorage: (ws: WorkspaceAddress) => IStorageAsync) => {
    // Boilerplate to help browser-run know when this test is completed (see browser-run.ts)
    // When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function..
    let nameOfRun = description;

    /* istanbul ignore next */ 
    if ((t.test as any).onFinish) {
        (t.test as any).onFinish(() => window.onFinish(`storage shared tests -- ${description}`));
    }

    t.test(nameOfRun + ': storage close() and throwing when closed', async (t: any) => {
        let workspace = '+gardening.abcde';
        let storage = makeStorage(workspace);
        let events: string[] = [];

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
        await doesNotThrow(t, async () => await storage.getDocsSinceLocalIndex('all', 0, 1), 'does not throw because not closed');
        await doesNotThrow(t, async () => await storage.getAllDocs(), 'does not throw because not closed');
        await doesNotThrow(t, async () => await storage.getLatestDocs(), 'does not throw because not closed');
        await doesNotThrow(t, async () => await storage.getAllDocsAtPath('/a'), 'does not throw because not closed');
        await doesNotThrow(t, async () => await storage.getLatestDocAtPath('/a'), 'does not throw because not closed');
        await doesNotThrow(t, async () => await storage.queryDocs(), 'does not throw because not closed');
        t.same(events, [], 'no events yet');

        loggerTest.debug('launching microtask, nextTick, setTimeout, and setImmediate');
        queueMicrotask(() => loggerTestCb.debug('--- microtask ---'));
        process.nextTick(() => loggerTestCb.debug('--- nextTick ---'));
        setTimeout(() => loggerTestCb.debug('--- setTimeout 0 ---'), 0);
        setImmediate(() => loggerTestCb.debug('--- setImmediate ---'));

        loggerTest.debug('closing...');
        await storage.close();
        loggerTest.debug('...done closing');

        // wait for didClose to happen on setTimeout
        await sleep(20);

        t.same(events, ['willClose', 'didClose'], 'closing events happened');

        t.same(storage.isClosed(), true, 'is closed after close()');

        await doesNotThrow(t, async () => storage.isClosed(), 'isClosed does not throw');
        await throws(t, async () => await storage.getDocsSinceLocalIndex('all', 0, 1), 'throws after closed');
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

        t.end();
    });

    t.test(nameOfRun + ': storage overwriteAllDocsByAuthor', async (t: any) => {
        let workspace = '+gardening.abcde';
        let storage = makeStorage(workspace);

        let keypair1 = storage.formatValidator.crypto.generateAuthorKeypair('aaaa');
        let keypair2 = storage.formatValidator.crypto.generateAuthorKeypair('aaaa');
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

        t.end();
    });

    // TODO: more StorageAsync tests
};
