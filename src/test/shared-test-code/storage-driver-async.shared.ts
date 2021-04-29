import t = require('tap');

import {
    Doc,
    WorkspaceAddress,
} from '../../util/doc-types';
import {
    Query,
} from '../../storage/query-types';
import {
    IStorageDriverAsync,
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

        t.same(driver.getHighestLocalIndex(), -1, 'highestLocalIndex starts at -1');
        t.same(await driver.queryDocs({}), [], 'query returns empty array');

        t.end();
    });

    t.test(nameOfRun + ': upsert and basic querying with one path', async (t: any) => {
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
        // same author, newer
        let doc2 = {
            ...doc1,
            content: 'Hello 2',
            timestamp: doc1.timestamp + 2, // make sure this one wins
            signature: 'whatever2',  // everything assumes different docs have different sigs
        }
        // second author, newer still
        let doc3 = {
            ...doc1,
            author: '@timm.baaaaaaaaaaaaaaaaaaaaaaaaazbqjwtzcnr7zyef2hvpftw45clq',
            content: 'Hello 3',
            timestamp: doc1.timestamp + 3, // make sure this one wins
            signature: 'whatever3',  // everything assumes different docs have different sigs
        }
        // second author, older
        let doc4 = {
            ...doc1,
            author: '@timm.baaaaaaaaaaaaaaaaaaaaaaaaazbqjwtzcnr7zyef2hvpftw45clq',
            content: 'Hello 4',
            timestamp: doc1.timestamp - 4, // make sure this one wins
            signature: 'whatever4',  // everything assumes different docs have different sigs
        }
        // third author, oldest
        let doc5 = {
            ...doc1,
            author: '@bobo.bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxnr7zyef2hvpftw45clq',
            content: 'Hello 5',
            timestamp: doc1.timestamp - 5, // make sure this one wins
            signature: 'whatever5',  // everything assumes different docs have different sigs
        }

        let docResult: Doc = await driver.upsert(doc1);
        t.same(docResult._localIndex, 0, 'upsert doc1, localIndex is now 0');
        t.same(driver.getHighestLocalIndex(), docResult._localIndex, 'driver.getHighestLocalIndex() matches doc._locaIndex');

        let docs = await driver.queryDocs({});
        t.same(docs.length, 1, 'query returns 1 doc');
        t.same(docs[0]._localIndex, 0, 'docs[0]._localIndex');
        t.same(docs[0].content, 'Hello 1', 'content is from doc1');

        //-----------------

        // overwrite same author, latest
        docResult = await driver.upsert(doc2);
        t.same(docResult._localIndex, 1, 'upsert doc2 from same author, localIndex is now 1');
        t.same(driver.getHighestLocalIndex(), docResult._localIndex, 'driver.getHighestLocalIndex() matches doc._locaIndex');

        docs = await driver.queryDocs({});
        t.same(docs.length, 1, 'query returns 1 doc');
        t.same(docs[0]._localIndex, 1, 'docs[0]._localIndex');
        t.same(docs[0].content, 'Hello 2', 'content is from doc2');

        //-----------------

        // add a second author, latest
        docResult = await driver.upsert(doc3);
        t.same(docResult._localIndex, 2, 'upsert doc3 from second author, localIndex is now 3');
        t.same(driver.getHighestLocalIndex(), docResult._localIndex, 'driver.getHighestLocalIndex() matches doc._locaIndex');

        let latestDocs = await driver.queryDocs({ historyMode: 'latest' });
        t.same(latestDocs.length, 1, 'there is 1 latest doc');
        t.same(latestDocs[0]._localIndex, 2, 'latestDocs[0]._localIndex');
        t.same(latestDocs[0].content, 'Hello 3', 'content is from doc3');

        let allDocs = await driver.queryDocs({ historyMode: 'all' });
        t.same(allDocs.length, 2, 'there are 2 overall docs');
        t.same(allDocs[0].content, 'Hello 3', "latestDocs[0].content is 3 (it's the latest)");
        t.same(allDocs[1].content, 'Hello 2', 'latestDocs[1].content is 2');

        //-----------------

        // add a second author, older, overwriting the previous newer one from same author.
        // -- should not bounce, that's the job of IStorage
        docResult = await driver.upsert(doc4);
        t.same(docResult._localIndex, 3, 'upsert doc4 from second author (but older), localIndex is now 3');
        t.same(driver.getHighestLocalIndex(), docResult._localIndex, 'driver.getHighestLocalIndex() matches doc._locaIndex');

        // latest doc is now from author 1
        latestDocs = await driver.queryDocs({ historyMode: 'latest' });
        t.same(latestDocs.length, 1, 'there is 1 latest doc');
        t.same(latestDocs[0]._localIndex, 1, 'latestDocs[0]._localIndex');
        t.same(latestDocs[0].content, 'Hello 2', 'content is from doc2');

        allDocs = await driver.queryDocs({ historyMode: 'all' });
        t.same(allDocs.length, 2, 'there are 2 overall docs');
        t.same(allDocs[0].content, 'Hello 2', "latestDocs[0].content is 2 (it's the latest)");
        t.same(allDocs[1].content, 'Hello 4', 'latestDocs[1].content is 4');

        //-----------------

        // add a third author, oldest
        docResult = await driver.upsert(doc5);
        t.same(docResult._localIndex, 4, 'upsert doc5 from new third author (but oldest), localIndex is now 5');
        t.same(driver.getHighestLocalIndex(), docResult._localIndex, 'driver.getHighestLocalIndex() matches doc._locaIndex');

        // latest doc is still from author 1
        latestDocs = await driver.queryDocs({ historyMode: 'latest' });
        t.same(latestDocs.length, 1, 'there is 1 latest doc');
        t.same(latestDocs[0]._localIndex, 1, 'latestDocs[0]._localIndex is 1');
        t.same(latestDocs[0].content, 'Hello 2', 'content is from doc2');

        allDocs = await driver.queryDocs({ historyMode: 'all' });
        t.same(allDocs.length, 3, 'there are 2 overall docs');
        t.same(allDocs[0].content, 'Hello 2', "latestDocs[0].content is 2 (it's the latest)");
        t.same(allDocs[1].content, 'Hello 4', 'latestDocs[1].content is 4');
        t.same(allDocs[2].content, 'Hello 5', 'latestDocs[2].content is 5');

        //-----------------
        // test querying

        type Vector = { query: Query, expectedContent: string[] };
        let vectors: Vector[] = [
            {
                query: {
                    historyMode: 'all',
                    orderBy: 'localIndex ASC',
                },
                expectedContent: ['Hello 2', 'Hello 4', 'Hello 5'],
            },
            {
                query: {
                    historyMode: 'all',
                    orderBy: 'localIndex ASC',
                    limit: 2,
                },
                expectedContent: ['Hello 2', 'Hello 4'],
            },
            {
                query: {
                    historyMode: 'all',
                    orderBy: 'localIndex ASC',
                    startAt: { localIndex: 3 },
                },
                expectedContent: ['Hello 4', 'Hello 5'],
            },
            {
                query: {
                    historyMode: 'all',
                    orderBy: 'localIndex ASC',
                    startAt: { path: 'a' },  // invalid combo of orderBy and startAt
                },
                expectedContent: [],
            },
            {
                query: {
                    historyMode: 'all',
                    orderBy: 'localIndex ASC',
                    startAt: { localIndex: 3 },
                    limit: 1,
                },
                expectedContent: ['Hello 4'],
            },
            {
                query: {
                    historyMode: 'all',
                    orderBy: 'localIndex DESC',
                },
                expectedContent: ['Hello 5', 'Hello 4', 'Hello 2'],
            },
            {
                query: {
                    historyMode: 'all',
                    orderBy: 'path ASC',
                },
                // sort by timestamp when path is the same, as it is here
                expectedContent: ['Hello 2', 'Hello 4', 'Hello 5'],
            },
            {
                query: {
                    historyMode: 'latest',
                },
                expectedContent: ['Hello 2'],
            },
            {
                query: {},
                expectedContent: ['Hello 2'],
            },
            {
                query: { limit: 0, },
                expectedContent: [],
            },
            {
                query: {
                    historyMode: 'all',
                    orderBy: 'path ASC',
                    filter: { author: doc1.author, },
                },
                expectedContent: ['Hello 2'],
            },
        ];

        for (let { query, expectedContent } of vectors) {
            let qr = await driver.queryDocs(query);
            let actualContent = qr.map(doc => doc.content);
            t.same(actualContent, expectedContent, `query: ${J(query)}`);
        }

        t.end();
    });

};