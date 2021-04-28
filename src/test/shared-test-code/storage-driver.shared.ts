import t = require('tap');

import {
    Doc,
    WorkspaceAddress,
} from '../../util/doc-types';
import {
    IStorageDriverAsync
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

export let runStorageDriverTests = (driverName: string, makeDriver: (ws: WorkspaceAddress) => IStorageDriverAsync) => {
    // Boilerplate to help browser-run know when this test is completed (see browser-run.ts)
    // When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function..
    let nameOfRun = driverName;

    /* istanbul ignore next */ 
    if ((t.test as any).onFinish) {
        (t.test as any).onFinish(() => window.onFinish(`storage driver shared tests -- ${driverName}`));
    }

    t.test(nameOfRun + ': empty storage', async (t: any) => {
        let workspace = '+gardening.abcde';
        let driver = makeDriver(workspace);

        t.same(driver.getHighestLocalIndex(), 0, 'highestLocalIndex starts at 0');
        t.same(await driver.queryDocs({}), [], 'query returns empty array');

        t.end();
    });

    t.test(nameOfRun + ': upsert and basic querying', async (t: any) => {
        let workspace = '+gardening.abcde';
        let driver = makeDriver(workspace);

        let doc1: Doc = {
            format: 'es.4',
            author: '@suzy.bolxx3bc6gmoa43rr5qfgv6r65zbqjwtzcnr7zyef2hvpftw45clq',
            content: 'Hello 1',
            contentHash: 'bnkc2f3fbdfpfeanwcgbid4t2lanmtq2obsvijhsagmn3x652h57a',
            deleteAfter: null,
            path: '/posts/post-0000.txt',
            timestamp: 1619627796035000,
            workspace: '+gardening.abc',
            signature: 'whatever1',  // upsert does not check signature or validate doc
        }
        let doc2 = {
            ...doc1,
            content: 'Hello 2',
            timestamp: doc1.timestamp + 2, // make sure this one wins
            signature: 'whatever2',  // everything assumes different docs have different sigs
        }
        let doc3 = {
            ...doc1,
            author: '@timm.baaaaaaaaaaaaaaaaaaaaaaaaazbqjwtzcnr7zyef2hvpftw45clq',
            content: 'Hello 3',
            timestamp: doc1.timestamp + 3, // make sure this one wins
            signature: 'whatever3',  // everything assumes different docs have different sigs
        }

        let success: boolean = await driver.upsert(doc1);
        t.same(success, true, 'upsert doc1; claimed success');

        t.same(driver.getHighestLocalIndex(), 1, 'highestLocalIndex is now 1');

        let docs = await driver.queryDocs({});
        t.same(docs.length, 1, 'query returns 1 doc');
        t.same(docs[0]._localIndex, 1, 'docs[0]._localIndex is 1');
        t.same(docs[0].content, 'Hello 1', 'content is from doc1');

        //-----------------

        // overwrite same author, latest
        success = await driver.upsert(doc2);
        t.same(success, true, 'upsert doc2 from same author; claimed success');

        t.same(driver.getHighestLocalIndex(), 2, 'highestLocalIndex is now 2');

        docs = await driver.queryDocs({});
        t.same(docs.length, 1, 'query returns 1 doc');
        t.same(docs[0]._localIndex, 2, 'docs[0]._localIndex is 2');
        t.same(docs[0].content, 'Hello 2', 'content is from doc2');

        //-----------------

        // add a new author, latest
        success = await driver.upsert(doc3);
        t.same(success, true, 'upsert doc3 from new author; claimed success');

        t.same(driver.getHighestLocalIndex(), 3, 'highestLocalIndex is now 3');

        let latestDocs = await driver.queryDocs({ historyMode: 'latest' });
        t.same(latestDocs.length, 1, 'there is 1 latest doc');
        t.same(latestDocs[0]._localIndex, 3, 'latestDocs[0]._localIndex is 3');
        t.same(latestDocs[0].content, 'Hello 3', 'content is from doc3');

        let allDocs = await driver.queryDocs({ historyMode: 'all' });
        t.same(allDocs.length, 2, 'there are 2 overall docs');
        t.same(allDocs[0].content, 'Hello 3', "latestDocs[0].content is 3 (it's the latest)");
        t.same(allDocs[1].content, 'Hello 2', 'latestDocs[1].content is 2');

        t.end();
    });

};