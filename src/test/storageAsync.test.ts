import * as fs from 'fs';
import t = require('tap');
//t.runOnly = true;

import {
    AuthorKeypair,
    Document,
    FormatName,
    IStorage,
    IValidator,
    SyncOpts,
    WriteResult,
    isErr,
    notErr,
    WriteEvent,
    ValidationError,
    IStorageAsync,
} from '../util/types';
import {
    generateAuthorKeypair,
    sha256base32,
} from '../crypto/crypto';
import { ValidatorEs4 } from '../validator/es4';
import { StorageMemory } from '../storage/memory';
import { StorageSqlite } from '../storage/sqlite';
import { StorageSyncToAsync } from '../storage/syncToAsync';
import { logTest } from '../util/log';

//================================================================================
// prepare for test scenarios

let WORKSPACE = '+gardenclub.xxxxxxxxxxxxxxxxxxxx';
let WORKSPACE2 = '+another.xxxxxxxxxxxxxxxxxxxx';

let VALIDATORS : IValidator[] = [ValidatorEs4];
let FORMAT : FormatName = VALIDATORS[0].format;

let keypair1 = generateAuthorKeypair('test') as AuthorKeypair;
let keypair2 = generateAuthorKeypair('twoo') as AuthorKeypair;
let keypair3 = generateAuthorKeypair('thre') as AuthorKeypair;
let keypair4 = generateAuthorKeypair('four') as AuthorKeypair;
if (isErr(keypair1)) { throw "oops"; }
if (isErr(keypair2)) { throw "oops"; }
if (isErr(keypair3)) { throw "oops"; }
if (isErr(keypair4)) { throw "oops"; }
let author1 = keypair1.address;
let author2 = keypair2.address;
let author3 = keypair3.address;
let author4 = keypair4.address;
let now = 1500000000000000;

let SEC = 1000000;
let MIN = SEC * 60;
let HOUR = MIN * 60;
let DAY = HOUR * 24;

interface Scenario {
    makeStorage: (workspace : string) => IStorageAsync,
    description: string,
}
let scenarios : Scenario[] = [
    {
        makeStorage: (workspace : string) : IStorageAsync =>
            new StorageSyncToAsync(new StorageMemory(VALIDATORS, workspace)),
        description: 'StoreMemory to async',
    },
];

//================================================================================


for (let scenario of scenarios) {
    t.test(`==== starting test of ====${scenario.description}`, (t: any) => {
        t.end();
    });

    t.test(scenario.description + ': empty store', async (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);
        t.same(await storage.paths(), [], 'no paths');
        t.same(await storage.documents(), [], 'no docs');
        t.same(await storage.contents(), [], 'no contents');
        t.equal(await storage.getDocument('xxx'), undefined, 'getDocument undefined');
        t.equal(await storage.getContent('xxx'), undefined, 'getContent undefined');
        t.same(await storage.authors(), [], 'no authors');
        t.end();
    });

    t.test(scenario.description + ': close', async (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);
        let storage2 = scenario.makeStorage(WORKSPACE);

        t.same(storage.isClosed(), false, 'starts off not closed');
        await storage.close();
        t.same(storage.isClosed(), true, 'becomes closed');
        await storage.close();
        t.same(storage.isClosed(), true, 'stays closed');

        try {
            await storage.contents();
            t.fail('contents() did not throw when closed');
        } catch (e) {
            t.ok(true, 'contents() threw when closed');
        };

        t.end();
    });

    t.test(scenario.description + ': store ingestDocument rejects invalid docs', async (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        let doc1: Document = {
            format: FORMAT,
            workspace: WORKSPACE,
            path: '/k1',
            contentHash: sha256base32('v1'),
            content: 'v1',
            timestamp: now,
            deleteAfter: null,
            author: author1,
            signature: 'xxx',
        };
        let signedDoc = ValidatorEs4.signDocument(keypair1, doc1) as Document;
        t.ok(notErr(signedDoc), 'signature succeeded');
        t.same(await storage.ingestDocument(signedDoc), WriteResult.Accepted, "successful ingestion");
        t.equal(await storage.getContent('/k1'), 'v1', "getContent worked");

        t.ok(isErr(await storage.ingestDocument(doc1)), "don't ingest: bad signature");
        t.ok(isErr(await storage.ingestDocument({...signedDoc, format: 'xxx'})), "don't ingest: unknown format");
        t.ok(isErr(await storage.ingestDocument({...signedDoc, timestamp: now / 1000})), "don't ingest: timestamp too small, probably in milliseconds");
        t.ok(isErr(await storage.ingestDocument({...signedDoc, timestamp: now * 2})), "don't ingest: timestamp in future");
        t.ok(isErr(await storage.ingestDocument({...signedDoc, timestamp: Number.MAX_SAFE_INTEGER * 2})), "don't ingest: timestamp way too large");
        t.ok(isErr(await storage.ingestDocument({...signedDoc, workspace: 'xxx'})), "don't ingest: changed workspace after signing");

        let signedDocDifferentWorkspace = ValidatorEs4.signDocument(keypair1, {...doc1, workspace: 'xxx'}) as Document;
        t.ok(notErr(signedDocDifferentWorkspace), 'signature succeeded');
        t.ok(isErr(await storage.ingestDocument(signedDocDifferentWorkspace)), "don't ingest: mismatch workspace");

        t.ok(isErr(await storage.set(keypair1, {
            format: 'xxx',
            path: '/k1',
            content: 'v1',
        })), 'set rejects unknown format');

        let writablePaths = [
            '/hello',
            '/~' + author1 + '/about',
            '/chat/~@ffff.xxxx~' + author1,
        ];
        for (let path of writablePaths) {
            let signedDoc2 = ValidatorEs4.signDocument(keypair1, {...doc1, path: path});
            if (isErr(signedDoc2)) {
                t.ok(false, 'signature failed: ' + signedDoc2);
            } else {
                t.same(await storage.ingestDocument(signedDoc2), WriteResult.Accepted, 'do ingest: writable path ' + path);
            }
        }
        let notWritablePaths = [
            '/~@ffff.bxxxx/about',
            '/~',
        ];
        for (let path of notWritablePaths) {
            let signedDoc2 = ValidatorEs4.signDocument(keypair1, {...doc1, path: path});
            if (isErr(signedDoc2)) {
                t.ok(false, 'signature failed: ' + signedDoc2);
            } else {
                t.ok(isErr(await storage.ingestDocument(signedDoc2)), "don't ingest: non-writable path " + path);
            }
        }

        t.end();
    });

    t.test(scenario.description + ': basic one-author store', async (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);
        t.equal(await storage.getContent('/path1'), undefined, 'nonexistant paths are undefined');
        t.equal(await storage.getContent('/path2'), undefined, 'nonexistant paths are undefined');

        // set a decoy path to make sure the later tests return the correct path
        t.same(await storage.set(keypair1, {format: FORMAT, path: '/decoy', content:'zzz', timestamp: now }, now), WriteResult.Accepted, 'set decoy path');

        t.same(await storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1.0', timestamp: now }, now), WriteResult.Accepted, 'set new path');
        t.equal(await storage.getContent('/path1'), 'val1.0');

        t.same(await storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1.2', timestamp: now + 2 }, now), WriteResult.Accepted, 'overwrite path with newer time');
        t.equal(await storage.getContent('/path1'), 'val1.2');

        // write with an old timestamp - this timestamp should be overridden to the existing timestamp + 1.
        // note that on ingest() the newer timestamp wins, but on set() we adjust the newly created timestamp
        // so it's always greater than the existing ones.
        t.same(await storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1.1', timestamp: now - 99 }, now), WriteResult.Ignored, 'do not supercede timestamp when providing one manually');
        t.same(await storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1.1' }, now), WriteResult.Accepted, 'automatically supercede previous timestamp');
        t.equal(await storage.getContent('/path1'), 'val1.1', 'superceded newer existing content');
        t.equal((await storage.getDocument('/path1'))?.timestamp, now + 3, 'timestamp was superceded by 1 microsecond');

        // should be alphabetical
        t.same(await storage.paths(), ['/decoy', '/path1'], 'paths() are correct');

        // order of contents should match order of paths
        t.same(await storage.contents(), ['zzz', 'val1.1'], 'contents() are correct');

        t.same(await storage.authors(), [author1], 'author');

        // returned document should have matching contentHash and content
        let doc = await storage.getDocument('/path1');
        if (doc === undefined) { t.ok(false, 'this doc should not be undefined'); }
        else {
            t.notEqual(doc.content, null, 'content should not be null');
            t.equal(doc.contentHash, sha256base32(doc.content), 'doc.contentHash matches doc.content after roundtrip');
        }

        t.end();
    });

    t.test(scenario.description + ': path queries', async (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);
        let paths = '/zzz /aaa /dir /q /qq /qqq /dir/a /dir/b /dir/c'.split(' ');
        let ii = 0;
        for (let path of paths) {
            t.same(await storage.set(keypair1, {format: FORMAT, path: path, content: 'true', timestamp: now + ii}), WriteResult.Accepted, 'set path: ' + path);
            ii += 1;
        }
        let sortedPaths = [...paths];
        sortedPaths.sort();
        let pathsFromStorage = await storage.paths();
        t.same(paths.length, pathsFromStorage.length, 'same number of paths');
        t.same(sortedPaths, pathsFromStorage, 'paths are sorted');

        t.same(await storage.paths({ path: '/q' }), ['/q'], 'query for specific path');
        t.same((await storage.documents({ path: '/q' })).map(doc => doc.path), ['/q'], 'query for specific path (documents)');
        t.same(await storage.paths({ path: '/nope' }), [], 'query for missing path');
        t.same(await storage.documents({ path: '/nope' }), [], 'query for missing path (documents)');

        t.same(await storage.paths({ lowPath: '/q', highPath: '/qqq' }), ['/q', '/qq'], 'lowPath <= k < highPath');
        t.same(await storage.paths({ lowPath: '/q', highPath: '/qqq', limit: 1 }), ['/q'], 'lowPath, highPath with limit');
        t.same(await storage.paths({ pathPrefix: '/dir' }), ['/dir', '/dir/a', '/dir/b', '/dir/c'], 'pathPrefix');
        t.same(await storage.paths({ pathPrefix: '/dir/' }), ['/dir/a', '/dir/b', '/dir/c'], 'pathPrefix');
        t.same(await storage.paths({ pathPrefix: '/dir/', limit: 2 }), ['/dir/a', '/dir/b'], 'pathPrefix with limit');
        t.end();
    });
    
    t.test(scenario.description + ': multi-author writes', async (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

       // set decoy paths to make sure the later tests return the correct path
        t.same(await storage.set(keypair1, {format: FORMAT, path: '/decoy2', content: 'zzz', timestamp: now}), WriteResult.Accepted, 'set decoy path 2');
        t.same(await storage.set(keypair1, {format: FORMAT, path: '/decoy1', content: 'aaa', timestamp: now}), WriteResult.Accepted, 'set decoy path 1');

        t.same(await storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'one', timestamp: now}), WriteResult.Accepted, 'set new path');
        t.equal(await storage.getContent('/path1'), 'one');

        // this will overwrite 'one' but the doc for 'one' will remain in history.
        // history will have 2 docs for this path.
        t.same(await storage.set(keypair2, {format: FORMAT, path: '/path1', content: 'two', timestamp: now + 1}), WriteResult.Accepted, 'update from a second author');
        t.equal(await storage.getContent('/path1'), 'two');

        // this will replace the old original doc 'one' from this author.
        // history will have 2 docs for this path.
        t.same(await storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'three', timestamp: now + 2}), WriteResult.Accepted, 'update from original author again');
        t.equal(await storage.getContent('/path1'), 'three');

        t.equal((await storage.paths()).length, 3, '3 paths');
        t.equal((await storage.contents()).length, 3, '3 contents');
        t.equal((await storage.contents({ includeHistory: true })).length, 4, '4 contents with history');

        t.same(await storage.paths(), ['/decoy1', '/decoy2', '/path1'], 'paths()');
        t.same(await storage.contents(), ['aaa', 'zzz', 'three'], 'contents()');
        t.same(await storage.contents({ includeHistory: true }), ['aaa', 'zzz', 'three', 'two'], 'contents with history, newest first');

        t.same(
            (await storage.documents({ includeHistory: true })).map((doc : Document) => doc.author),
            [author1, author1, author1, author2],
            'docs with history, newest first, docs should have correct authors'
        );

        let sortedAuthors = [author1, author2];
        sortedAuthors.sort();
        t.same(await storage.authors(), sortedAuthors, 'authors');

        // TODO: test 2 authors, same timestamps, different signatures

        t.end();
    });

    t.test(scenario.description + ': onChange', async (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        let numCalled = 0;
        let cb = () => { numCalled += 1; }
        let unsub = storage.onWrite.subscribe(cb);

        t.same(await storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1.0', timestamp: now}), WriteResult.Accepted, 'set new path');
        t.ok(isErr(await storage.set(keypair1, {format: 'xxx', path: '/path1', content: 'val1.1', timestamp: now})), 'invalid set that will be ignored');
        t.equal(await storage.getContent('/path1'), 'val1.0', 'second set was ignored');

        t.equal(numCalled, 1, 'callback was called once');
        unsub();

        t.same(await storage.set(keypair1, {format: FORMAT, path: '/path2', content: 'val2.0', timestamp: now + 1}), WriteResult.Accepted, 'set another path');

        t.equal(numCalled, 1, 'callback was not called after unsubscribing');

        t.end();
    });

    t.test(scenario.description + ': set(): manual vs default (bumped) timestamps & bounds-checking timestamps', async (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        // default timestamps
        t.same(await storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'default now'                       }, now), WriteResult.Accepted, 'absent timestamp: now');
        t.same((await storage.getDocument('/path1'))?.timestamp, now, '= now');
        t.same(await storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'default now'                       }, now), WriteResult.Accepted, 'absent timestamp: bumped');
        t.same((await storage.getDocument('/path1'))?.timestamp, now + 1, '= now + 1');
        t.same(await storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'default now', timestamp: 0         }, now), WriteResult.Accepted, 'zero timestamp: bumped');
        t.same((await storage.getDocument('/path1'))?.timestamp, now + 2, '= now + 2');
        t.same(await storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'default now', timestamp: undefined }, now), WriteResult.Accepted, 'undefined timestamp: bumped');
        t.same((await storage.getDocument('/path1'))?.timestamp, now + 3, '= now + 3');

        // manual timestamps
        t.same(await storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'manual now-10', timestamp: now - 10}, now), WriteResult.Ignored, 'manual timestamp in past from same author is ignored');

        t.same(await storage.set(keypair2, {format: FORMAT, path: '/path1', content: 'manual now-10', timestamp: now - 10}, now), WriteResult.Accepted, 'manual timestamp in past');
        t.same((await storage.documents({ includeHistory: true, versionsByAuthor: keypair2.address }))[0].timestamp, now - 10, '= now - 10');

        t.same(await storage.set(keypair3, {format: FORMAT, path: '/path1', content: 'manual now+10', timestamp: now + 10}, now), WriteResult.Accepted, 'manual timestamp in future');
        t.same((await storage.documents({ includeHistory: true, versionsByAuthor: keypair3.address }))[0].timestamp, now + 10, '= now + 10');

        // invalid timestamps
        t.ok(await storage.set(keypair4, {format: FORMAT, path: '/path1', content: 'milliseconds', timestamp: Date.now() }, now)
            instanceof ValidationError, 'millisecond timestamp: rejected');
        t.ok(await storage.set(keypair4, {format: FORMAT, path: '/path1', content: 'milliseconds', deleteAfter: Date.now() }, now)
            instanceof ValidationError, 'millisecond deleteAfter: rejected');
        t.ok(await storage.set(keypair4, {format: FORMAT, path: '/path1', content: 'milliseconds', timestamp: now, deleteAfter: now - 5 }, now)
            instanceof ValidationError, 'deleteAfter and timestamp out of order: rejected');

        t.end();
    });

}
