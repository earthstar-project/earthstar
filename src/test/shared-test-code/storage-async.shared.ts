import t = require('tap');

import {
    Doc,
    WorkspaceAddress,
} from '../../util/doc-types';
import {
    Query,
} from '../../storage/query-types';
import {
    IStorageAsync,
} from '../../storage/storage-types';

//================================================================================

import {
    LogLevel,
    setDefaultLogLevel,
} from '../../util/log';

//setDefaultLogLevel(LogLevel.Debug);

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

        t.same(storage.isClosed(), false, 'is not initially closed');
        await doesNotThrow(t, async () => storage.isClosed(), 'isClosed does not throw');
        await doesNotThrow(t, async () => await storage.getDocsSinceLocalIndex('all', 0, 1), 'throws after closed');
        await doesNotThrow(t, async () => await storage.getAllDocs(), 'throws after closed');
        await doesNotThrow(t, async () => await storage.getLatestDocs(), 'throws after closed');
        await doesNotThrow(t, async () => await storage.getAllDocsAtPath('/a'), 'throws after closed');
        await doesNotThrow(t, async () => await storage.getLatestDocAtPath('/a'), 'throws after closed');
        await doesNotThrow(t, async () => await storage.queryDocs(), 'throws after closed');

        await storage.close();

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

        t.end();
    });

    // TODO: more Storage tests
};
