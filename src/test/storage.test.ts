import * as fs from 'fs';
import t = require('tap');
//t.runOnly = true;

import {
    AuthorAddress,
    Document,
    FormatName,
    IStorage,
    IValidatorNew,
    SyncOpts,
} from '../util/types';
import {
    generateAuthorKeypair,
    sha256,
} from '../crypto/crypto';
import { ValidatorNew_Es4 } from '../validator/es4new';
import { StorageMemory } from '../storage/memory';
import { StorageSqlite } from '../storage/sqlite';
import { logTest } from '../util/log';

//================================================================================
// prepare for test scenarios

let WORKSPACE = '+gardenclub.xxxxxxxxxxxxxxxxxxxx';
let WORKSPACE2 = '+another.xxxxxxxxxxxxxxxxxxxx';

let VALIDATORS : IValidatorNew[] = [ValidatorNew_Es4];
let FORMAT : FormatName = VALIDATORS[0].format;

let keypair1 = generateAuthorKeypair('test');
let keypair2 = generateAuthorKeypair('twoo');
let keypair3 = generateAuthorKeypair('thre');
let author1: AuthorAddress = keypair1.address;
let author2: AuthorAddress = keypair2.address;
let author3: AuthorAddress = keypair3.address;
let now = 1500000000000000;

let SEC = 1000000;
let MIN = SEC * 60;
let HOUR = MIN * 60;
let DAY = HOUR * 24;

interface Scenario {
    makeStorage: (workspace : string) => IStorage,
    description: string,
}
let scenarios : Scenario[] = [
    {
        makeStorage: (workspace : string) : IStorage => new StorageMemory(VALIDATORS, workspace),
        description: 'StoreMemory',
    },
    {
        makeStorage: (workspace : string) : IStorage => new StorageSqlite({
            mode: 'create',
            workspace: workspace,
            validators: VALIDATORS,
            filename: ':memory:'
        }),
        description: "StoreSqlite(':memory:')",
    },
];

//================================================================================
// memory specific tests

t.test(`StoreMemory: constructor`, (t: any) => {
    t.throws(() => new StorageMemory([], WORKSPACE), 'throws when no validators are provided');
    t.throws(() => new StorageMemory(VALIDATORS, 'bad-workspace-address'), 'throws when workspace address is invalid');
    t.done();
});

//================================================================================
// sqlite specific tests

t.test(`StoreSqlite: opts: workspace and filename requirements`, (t: any) => {
    let fn : string;
    let clearFn = (fn : string) => {
        if (fs.existsSync(fn)) { fs.unlinkSync(fn); }
    }
    let touchFn = (fn : string) => { fs.writeFileSync(fn, 'foo'); }

    // create with :memory:
    t.throws(() => new StorageSqlite({
        mode: 'create',
        workspace: null,
        validators: VALIDATORS,
        filename: ':memory:'
    }), 'create mode throws when workspace is null, :memory:');
    t.doesNotThrow(() => new StorageSqlite({
        mode: 'create',
        workspace: WORKSPACE,
        validators: VALIDATORS,
        filename: ':memory:'
    }), 'create mode works when workspace is provided, :memory:');
    t.throws(() => new StorageSqlite({
        mode: 'create',
        workspace: 'bad-workspace-address',
        validators: VALIDATORS,
        filename: ':memory:'
    }), 'create mode throws when workspace address is invalid, :memory:');
    t.throws(() => new StorageSqlite({
        mode: 'create',
        workspace: WORKSPACE,
        validators: [],
        filename: ':memory:'
    }), 'create mode fails when no validators are provided');

    // create with real filename
    fn = 'testtesttest1.db';
    clearFn(fn);
    t.doesNotThrow(() => new StorageSqlite({
        mode: 'create',
        workspace: WORKSPACE,
        validators: VALIDATORS,
        filename: fn,
    }), 'create mode works when workspace is provided and a real filename');
    t.ok(fs.existsSync(fn), 'create mode created a file');
    clearFn(fn);

    // create with existing filename
    fn = 'testtesttest1b.db';
    touchFn(fn);
    t.throws(() => new StorageSqlite({
        mode: 'create',
        workspace: WORKSPACE,
        validators: VALIDATORS,
        filename: fn,
    }), 'create mode throws when pointed at existing file');
    clearFn(fn);

    // open and :memory:
    t.throws(() => new StorageSqlite({
        mode: 'open',
        workspace: WORKSPACE,
        validators: VALIDATORS,
        filename: ':memory:',
    }), 'open mode throws with :memory: and a workspace');
    t.throws(() => new StorageSqlite({
        mode: 'open',
        workspace: null,
        validators: VALIDATORS,
        filename: ':memory:',
    }), 'open mode throws with :memory: and null workspace');

    // open missing filename
    t.throws(() => new StorageSqlite({
        mode: 'open',
        workspace: WORKSPACE,
        validators: VALIDATORS,
        filename: 'xxx',
    }), 'open mode throws when file does not exist');

    // open and real but missing filename
    fn = 'testtesttest2.db';
    clearFn(fn);
    t.throws(() => new StorageSqlite({
        mode: 'open',
        workspace: WORKSPACE,
        validators: VALIDATORS,
        filename: fn,
    }), 'open mode throws when workspace is provided and file does not exist');
    clearFn(fn);
    t.throws(() => new StorageSqlite({
        mode: 'open',
        workspace: null,
        validators: VALIDATORS,
        filename: fn,
    }), 'open mode throws when workspace is null and file does not exist');
    clearFn(fn);

    // create-or-open :memory:
    t.doesNotThrow(() => new StorageSqlite({
        mode: 'create-or-open',
        workspace: WORKSPACE,
        validators: VALIDATORS,
        filename: ':memory:'
    }), 'create-or-open mode works when workspace is provided');
    t.throws(() => new StorageSqlite({
        mode: 'create-or-open',
        workspace: null,
        validators: VALIDATORS,
        filename: ':memory:'
    }), 'create-or-open mode throws when workspace is null');

    // create-or-open: create then open real file
    fn = 'testtesttest3.db';
    clearFn(fn);
    t.doesNotThrow(() => new StorageSqlite({
        mode: 'create-or-open',
        workspace: WORKSPACE,
        validators: VALIDATORS,
        filename: fn,
    }), 'create-or-open mode works when creating a real file');
    t.ok(fs.existsSync(fn), 'create-or-open mode created a file');
    t.throws(() => new StorageSqlite({
        mode: 'create-or-open',
        workspace: 'xxx',
        validators: VALIDATORS,
        filename: fn,
    }), 'create-or-open mode fails when opening existing file with mismatched workspace');
    t.doesNotThrow(() => new StorageSqlite({
        mode: 'create-or-open',
        workspace: WORKSPACE,
        validators: VALIDATORS,
        filename: fn,
    }), 'create-or-open mode works when opening a real file with matching workspace');
    clearFn(fn);

    // open: create then open real file
    fn = 'testtesttest4.db';
    clearFn(fn);
    t.doesNotThrow(() => new StorageSqlite({
        mode: 'create',
        workspace: WORKSPACE,
        validators: VALIDATORS,
        filename: fn,
    }), 'creating a real file');
    t.ok(fs.existsSync(fn), 'file was created');
    t.throws(() => new StorageSqlite({
        mode: 'open',
        workspace: 'xxx',
        validators: VALIDATORS,
        filename: fn,
    }), 'open throws when workspace does not match');
    t.doesNotThrow(() => new StorageSqlite({
        mode: 'open',
        workspace: WORKSPACE,
        validators: VALIDATORS,
        filename: fn,
    }), 'open works when workspace matches');
    t.doesNotThrow(() => new StorageSqlite({
        mode: 'open',
        workspace: null,
        validators: VALIDATORS,
        filename: fn,
    }), 'open works when workspace is null');
    clearFn(fn);

    // unrecognized mode
    t.throws(() => new StorageSqlite({
        mode: 'xxx' as any,
        workspace: null,
        validators: VALIDATORS,
        filename: ':memory:'
    }), 'constructor throws with unrecognized mode');

    t.done();
});

t.test(`StoreSqlite: config`, (t: any) => {
    let storage = new StorageSqlite({
        mode: 'create',
        workspace: WORKSPACE,
        validators: VALIDATORS,
        filename: ':memory:'
    });
    t.equal(storage._getConfig('foo'), null);
    storage._setConfig('foo', 'bar');
    t.equal(storage._getConfig('foo'), 'bar');
    storage._setConfig('foo', 'baz');
    t.equal(storage._getConfig('foo'), 'baz');
    t.done();
});

//================================================================================
// run the standard store tests on each scenario

for (let scenario of scenarios) {
    t.test(`==== starting test of ====${scenario.description}`, (t: any) => {
        t.done();
    });

    t.test(scenario.description + ': empty store', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);
        t.same(storage.paths(), [], 'no paths');
        t.same(storage.documents(), [], 'no docs');
        t.same(storage.contents(), [], 'no contents');
        t.equal(storage.getDocument('xxx'), undefined, 'getDocument undefined');
        t.equal(storage.getContent('xxx'), undefined, 'getContent undefined');
        t.same(storage.authors(), [], 'no authors');
        t.done();
    });

    t.test(scenario.description + ': store ingestDocument rejects invalid docs', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        let doc1: Document = {
            format: FORMAT,
            workspace: WORKSPACE,
            path: '/k1',
            contentHash: sha256('v1'),
            content: 'v1',
            timestamp: now,
            author: author1,
            signature: 'xxx',
        };
        let signedDoc = ValidatorNew_Es4.signDocument(keypair1, doc1);
        t.ok(storage.ingestDocument(signedDoc), "successful ingestion");
        t.equal(storage.getContent('/k1'), 'v1', "getContent worked");

        t.notOk(storage.ingestDocument(doc1), "don't ingest: bad signature");
        t.notOk(storage.ingestDocument({...signedDoc, format: 'xxx'}), "don't ingest: unknown format");
        t.notOk(storage.ingestDocument({...signedDoc, timestamp: now / 1000}), "don't ingest: timestamp too small, probably in milliseconds");
        t.notOk(storage.ingestDocument({...signedDoc, timestamp: now * 2}), "don't ingest: timestamp in future");
        t.notOk(storage.ingestDocument({...signedDoc, timestamp: Number.MAX_SAFE_INTEGER * 2}), "don't ingest: timestamp way too large");
        t.notOk(storage.ingestDocument({...signedDoc, workspace: 'xxx'}), "don't ingest: changed workspace after signing");

        let signedDocDifferentWorkspace = ValidatorNew_Es4.signDocument(keypair1, {...doc1, workspace: 'xxx'});
        t.notOk(storage.ingestDocument(signedDocDifferentWorkspace), "don't ingest: mismatch workspace");

        t.notOk(storage.set(keypair1, {
            format: 'xxx',
            path: '/k1',
            content: 'v1',
        }), 'set rejects unknown format');

        let writablePaths = [
            '/hello',
            '/~' + author1 + '/about',
            '/chat/~@ffff.xxxx~' + author1,
        ];
        for (let path of writablePaths) {
            t.ok(storage.ingestDocument(
                ValidatorNew_Es4.signDocument(
                    keypair1,
                    {...doc1, path: path}
                )),
                "do ingest: writable path " + path
            );
        }
        let notWritablePaths = [
            '/~@ffff.xxxx/about',
            '/~',
        ];
        for (let path of notWritablePaths) {
            t.notOk(storage.ingestDocument(
                ValidatorNew_Es4.signDocument(
                    keypair1,
                    {...doc1, path: path}
                )),
                "don't ingest: non-writable path " + path
            );
        }

        t.done();
    });

    t.test(scenario.description + ': deleteAfter', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        // an expired ephemeral doc can't be set because it's invalid
        t.notOk(storage.set(keypair1, {
                format: FORMAT,
                path: '/path1',
                content: 'aaa',
                timestamp: now - 60*MIN,
                deleteAfter: now - 45*MIN,
        }, now), 'set expired ephemeral document');
        t.equal(storage.getContent('/path1', now), undefined, 'temporary doc is not there');

        // a good doc.  make sure deleteAfter survives the roundtrip
        t.ok(storage.set(keypair1, {
                format: FORMAT,
                path: '/ephemeral',
                content: 'bbb',
                timestamp: now,
                deleteAfter: now + 3 * DAY,
        }, now), 'set good ephemeral document');
        t.ok(storage.set(keypair1, {
                format: FORMAT,
                path: '/regular',
                content: 'ccc',
                timestamp: now,
        }, now), 'set good regular document');
        let ephDoc = storage.getDocument('/ephemeral', now);
        let regDoc = storage.getDocument('/regular', now);

        if (ephDoc === undefined) {
            t.true(false, 'ephDoc was not set, or not retrieved');
        } else {
            t.true('deleteAfter' in (ephDoc as any), 'ephemeral doc has deleteAfter after roundtrip');
            t.equal(ephDoc?.deleteAfter, now + 3 * DAY, 'ephemeral doc deleteAfter value survived roundtrip');
        }
        if (regDoc === undefined) {
            t.true(false, 'regDoc was not set, or not retrieved');
        } else {
            t.false('deleteAfter' in (regDoc as any), 'as expected, regular doc does not have deleteAfter property');
        }

        // a doc that was valid when set, but expired while sitting in the database, then was read after being expired
        let setExpiringDoc = () => {
            t.ok(storage.set(keypair1, {
                    format: FORMAT,
                    path: '/expire-in-place',
                    content: 'ccc',
                    timestamp: now - 1,
                    deleteAfter: now + 5 * DAY,
            }, now), 'set good ephemeral document');
        };

        if (scenario.description === 'StoreMemory') {
            // TODO: enable these deleteAfter tests for sqlite too

            // set the doc, observe it in place.
            // set now ahead, try to get the doc, which should delete it.
            // rewind now again, and the doc should still be gone because it was deleted.
            setExpiringDoc();
            t.notEqual(storage.getDocument('/expire-in-place', now          ), undefined, 'getDocument(): doc was there');
            t.equal(   storage.getDocument('/expire-in-place', now + 8 * DAY), undefined, 'getDocument(): doc expired in place');
            t.equal(   storage.getDocument('/expire-in-place', now          ), undefined, 'getDocument(): doc was deleted after expiring');

            setExpiringDoc();
            t.equal(storage.getContent('/expire-in-place', now          ), 'ccc',     'getContent(): doc was there');
            t.equal(storage.getContent('/expire-in-place', now + 8 * DAY), undefined, 'getContent(): doc expired in place');
            t.equal(storage.getContent('/expire-in-place', now          ), undefined, 'getContent(): doc was deleted after expiring');

            setExpiringDoc();
            t.same(storage.paths({pathPrefix: '/exp', now: now          }), ['/expire-in-place'], 'paths(): doc was there');
            t.same(storage.paths({pathPrefix: '/exp', now: now + 8 * DAY}), [], 'paths(): doc expired in place');
            t.same(storage.paths({pathPrefix: '/exp', now: now          }), [], 'paths(): doc was deleted after expiring');

            setExpiringDoc();
            t.same(storage.documents({pathPrefix: '/exp', now: now          }).length, 1, 'documents(): doc was there');
            t.same(storage.documents({pathPrefix: '/exp', now: now + 8 * DAY}).length, 0, 'documents(): doc expired in place');
            t.same(storage.documents({pathPrefix: '/exp', now: now          }).length, 0, 'documents(): doc was deleted after expiring');
        }

        // TODO for ephemeral doc tests:
        //
        // careful check of sqlite code for now parameter
        //
        // implement removal and result checking in sqlite
        //
        // test includeHistory
        // test limit
        // test participatingAuthor
        //
        // uh oh
        //      an expiring doc can overwrite a real doc and then expire and vanish
        //      and then the original doc is locally gone, but could come back during a sync
        //      depending on how far the expiring doc propagated through the network...

        t.done();
    });

    t.test(scenario.description + ': one-author store', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);
        t.equal(storage.getContent('/path1'), undefined, 'nonexistant paths are undefined');
        t.equal(storage.getContent('/path2'), undefined, 'nonexistant paths are undefined');

        // set a decoy path to make sure the later tests return the correct path
        t.ok(storage.set(keypair1, {format: FORMAT, path: '/decoy', content:'zzz', timestamp: now}), 'set decoy path');

        t.ok(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1.0', timestamp: now}), 'set new path');
        t.equal(storage.getContent('/path1'), 'val1.0');

        t.ok(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1.2', timestamp: now + 2}), 'overwrite path with newer time');
        t.equal(storage.getContent('/path1'), 'val1.2');

        // write with an old timestamp - this timestamp should be overridden to the existing timestamp + 1.
        // note that on ingest() the newer timestamp wins, but on set() we adjust the newly created timestamp
        // so it's always greater than the existing ones.
        t.ok(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1.1', timestamp: now-99}), 'automatically supercede previous timestamp');
        t.equal(storage.getContent('/path1'), 'val1.1', 'superceded newer existing content');
        t.equal(storage.getDocument('/path1')?.timestamp, now + 3, 'timestamp was superceded by 1 microsecond');

        // should be alphabetical
        t.same(storage.paths(), ['/decoy', '/path1'], 'paths() are correct');

        // order of contents should match order of paths
        t.same(storage.contents(), ['zzz', 'val1.1'], 'contents() are correct');

        t.same(storage.authors(), [author1], 'author');

        // returned document should have matching contentHash and content
        let doc = storage.getDocument('/path1');
        if (doc === undefined) { t.ok(false, 'this doc should not be undefined'); }
        else {
            t.notEqual(doc.content, null, 'content should not be null');
            t.equal(doc.contentHash, sha256(doc.content), 'doc.contentHash matches doc.content after roundtrip');
        }

        t.done();
    });

    t.test(scenario.description + ': path queries', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);
        let paths = '/zzz /aaa /dir /q /qq /qqq /dir/a /dir/b /dir/c'.split(' ');
        let ii = 0;
        for (let path of paths) {
            t.ok(storage.set(keypair1, {format: FORMAT, path: path, content: 'true', timestamp: now + ii}), 'set path: ' + path),
                ii += 1;
        }
        let sortedPaths = [...paths];
        sortedPaths.sort();
        let pathsFromStorage = storage.paths();
        t.same(paths.length, pathsFromStorage.length, 'same number of paths');
        t.same(sortedPaths, pathsFromStorage, 'paths are sorted');

        t.same(storage.paths({ path: '/q' }), ['/q'], 'query for specific path');
        t.same(storage.documents({ path: '/q' }).map(doc => doc.path), ['/q'], 'query for specific path (documents)');
        t.same(storage.paths({ path: '/nope' }), [], 'query for missing path');
        t.same(storage.documents({ path: '/nope' }), [], 'query for missing path (documents)');

        t.same(storage.paths({ lowPath: '/q', highPath: '/qqq' }), ['/q', '/qq'], 'lowPath <= k < highPath');
        t.same(storage.paths({ lowPath: '/q', highPath: '/qqq', limit: 1 }), ['/q'], 'lowPath, highPath with limit');
        t.same(storage.paths({ pathPrefix: '/dir' }), ['/dir', '/dir/a', '/dir/b', '/dir/c'], 'pathPrefix');
        t.same(storage.paths({ pathPrefix: '/dir/' }), ['/dir/a', '/dir/b', '/dir/c'], 'pathPrefix');
        t.same(storage.paths({ pathPrefix: '/dir/', limit: 2 }), ['/dir/a', '/dir/b'], 'pathPrefix with limit');
        t.done();
    });

    t.test(scenario.description + ': limits on queries', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        // three authors
        t.ok(storage.set(keypair1, {format: FORMAT, path: '/foo', content: 'foo', timestamp: now}), 'set data');
        t.ok(storage.set(keypair1, {format: FORMAT, path: '/pathA', content: 'content1', timestamp: now + 1}), 'set data');
        t.ok(storage.set(keypair2, {format: FORMAT, path: '/pathA', content: 'content2', timestamp: now + 2}), 'set data');
        t.ok(storage.set(keypair3, {format: FORMAT, path: '/pathA', content: 'content3', timestamp: now + 3}), 'set data');

        t.same(storage.authors(), [author1, author3, author2], 'authors');

        // queries with limits
        t.same(storage.paths( { includeHistory: true }), ['/foo', '/pathA'], 'paths with history, no limit');
        t.same(storage.contents({ includeHistory: true }), ['foo', 'content3', 'content2', 'content1'], 'contents with history, no limit');

        t.same(storage.paths( { includeHistory: true, limit: 1 }), ['/foo'], 'paths with history, limit 1');
        t.same(storage.contents({ includeHistory: true, limit: 1 }), ['foo'], 'contents with history, limit 1');

        t.same(storage.paths( { includeHistory: true, limit: 2 }), ['/foo', '/pathA'], 'paths with history, limit 2');
        t.same(storage.contents({ includeHistory: true, limit: 2 }), ['foo', 'content3'], 'contents with history, limit 2');

        t.same(storage.paths( { includeHistory: true, limit: 3 }), ['/foo', '/pathA'], 'paths with history, limit 3');
        t.same(storage.contents({ includeHistory: true, limit: 3 }), ['foo', 'content3', 'content2'], 'contents with history, limit 3');
        
        // no history
        t.same(storage.paths( { includeHistory: false }), ['/foo', '/pathA'], 'paths no history, no limit');
        t.same(storage.contents({ includeHistory: false }), ['foo', 'content3'], 'contents no history, no limit');

        t.same(storage.paths( { includeHistory: false, limit: 1 }), ['/foo'], 'paths no history, limit 1');
        t.same(storage.contents({ includeHistory: false, limit: 1 }), ['foo'], 'contents no history, limit 1');

        t.done();
    });

    t.test(scenario.description + ': path and author queries', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        // two authors
        t.ok(storage.set(keypair1, {format: FORMAT, path: '/pathA', content: 'content1.X', timestamp: now + 1}), 'set data');
        t.ok(storage.set(keypair2, {format: FORMAT, path: '/pathA', content: 'content2.Y', timestamp: now + 2}), 'set data');
        t.ok(storage.set(keypair1, {format: FORMAT, path: '/pathA', content: 'content1.Z', timestamp: now + 3}), 'set data');

        t.same(storage.authors(), [author1, author2], 'authors');

        // path queries
        t.same(storage.paths(    { path: '/pathA', includeHistory: false }), ['/pathA'], 'paths with path query');
        t.same(storage.contents(   { path: '/pathA', includeHistory: false }), ['content1.Z'], 'contents with path query');
        t.same(storage.documents({ path: '/pathA', includeHistory: false }).map(d => d.content), ['content1.Z'], 'documents with path query');

        t.same(storage.paths(    { path: '/pathA', includeHistory: true }), ['/pathA'], 'paths with path query, history');
        t.same(storage.contents(   { path: '/pathA', includeHistory: true }), ['content1.Z', 'content2.Y'], 'contents with path query, history');
        t.same(storage.documents({ path: '/pathA', includeHistory: true }).map(d => d.content), ['content1.Z', 'content2.Y'], 'documents with path query, history');

        // versionsByAuthor
        t.same(storage.paths({ versionsByAuthor: author1, includeHistory: true }), ['/pathA'], 'paths versionsByAuthor 1, history');
        t.same(storage.paths({ versionsByAuthor: author1, includeHistory: false }), ['/pathA'], 'paths versionsByAuthor 1, no history');
        t.same(storage.paths({ versionsByAuthor: author2, includeHistory: true }), ['/pathA'], 'paths versionsByAuthor 2, history');
        t.same(storage.paths({ versionsByAuthor: author2, includeHistory: false }), [], 'paths versionsByAuthor 2, no history');
        t.same(storage.contents({ versionsByAuthor: author1, includeHistory: true }), ['content1.Z'], 'contents versionsByAuthor 1, history');
        t.same(storage.contents({ versionsByAuthor: author1, includeHistory: false }), ['content1.Z'], 'contents versionsByAuthor 1, no history');
        t.same(storage.contents({ versionsByAuthor: author2, includeHistory: true }), ['content2.Y'], 'contents versionsByAuthor 2, history');
        t.same(storage.contents({ versionsByAuthor: author2, includeHistory: false }), [], 'contents versionsByAuthor 2, no history');
        t.same(storage.documents({ versionsByAuthor: author1, includeHistory: true }).length, 1, 'documents versionsByAuthor 1, history');
        t.same(storage.documents({ versionsByAuthor: author1, includeHistory: false }).length, 1, 'documents versionsByAuthor 1, no history');
        t.same(storage.documents({ versionsByAuthor: author2, includeHistory: true }).length, 1, 'documents versionsByAuthor 2, history');
        t.same(storage.documents({ versionsByAuthor: author2, includeHistory: false }).length, 0, 'documents versionsByAuthor 2, no history');

        //// participatingAuthor
        //// TODO: this is not implemented in sqlite yet
        //t.same(storage.contents({ participatingAuthor: author1, includeHistory: true }), ['content1.Z', 'content2.Y'], 'participatingAuthor 1, with history');
        //t.same(storage.contents({ participatingAuthor: author1, includeHistory: false }), ['content1.Z'], 'participatingAuthor 1, no history');
        //t.same(storage.contents({ participatingAuthor: author2, includeHistory: true }), ['content1.Z', 'content2.Y'], 'participatingAuthor 2, with history');
        //t.same(storage.contents({ participatingAuthor: author2, includeHistory: false }), ['content1.Z'], 'participatingAuthor 2, no history');

        t.done();
    });

    t.test(scenario.description + ': multi-author writes', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

       // set decoy paths to make sure the later tests return the correct path
        t.ok(storage.set(keypair1, {format: FORMAT, path: '/decoy2', content: 'zzz', timestamp: now}), 'set decoy path 2');
        t.ok(storage.set(keypair1, {format: FORMAT, path: '/decoy1', content: 'aaa', timestamp: now}), 'set decoy path 1');

        t.ok(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'one', timestamp: now}), 'set new path');
        t.equal(storage.getContent('/path1'), 'one');

        // this will overwrite 'one' but the doc for 'one' will remain in history.
        // history will have 2 docs for this path.
        t.ok(storage.set(keypair2, {format: FORMAT, path: '/path1', content: 'two', timestamp: now + 1}), 'update from a second author');
        t.equal(storage.getContent('/path1'), 'two');

        // this will replace the old original doc 'one' from this author.
        // history will have 2 docs for this path.
        t.ok(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'three', timestamp: now + 2}), 'update from original author again');
        t.equal(storage.getContent('/path1'), 'three');

        t.equal(storage.paths().length, 3, '3 paths');
        t.equal(storage.contents().length, 3, '3 contents');
        t.equal(storage.contents({ includeHistory: true }).length, 4, '4 contents with history');

        t.same(storage.paths(), ['/decoy1', '/decoy2', '/path1'], 'paths()');
        t.same(storage.contents(), ['aaa', 'zzz', 'three'], 'contents()');
        t.same(storage.contents({ includeHistory: true }), ['aaa', 'zzz', 'three', 'two'], 'contents with history, newest first');

        t.same(
            storage.documents({ includeHistory: true }).map((doc : Document) => doc.author),
            [author1, author1, author1, author2],
            'docs with history, newest first, docs should have correct authors'
        );

        let sortedAuthors = [author1, author2];
        sortedAuthors.sort();
        t.same(storage.authors(), sortedAuthors, 'authors');

        // TODO: test 2 authors, same timestamps, different signatures

        t.done();
    });

    t.test(scenario.description + ': sync: push to empty store', (t: any) => {
        let storage1 = scenario.makeStorage(WORKSPACE);
        let storage2 = scenario.makeStorage(WORKSPACE);

        // set up some paths
        t.ok(storage1.set(keypair1, {format: FORMAT, path: '/decoy2', content: 'zzz', timestamp: now}), 'author1 set decoy path');
        t.ok(storage1.set(keypair1, {format: FORMAT, path: '/decoy1', content: 'aaa', timestamp: now}), 'author1 set decoy path');
        t.ok(storage1.set(keypair1, {format: FORMAT, path: '/path1', content: 'one', timestamp: now}), 'author1 set path1');
        t.ok(storage1.set(keypair2, {format: FORMAT, path: '/path1', content: 'two', timestamp: now + 1}), 'author2 set path1');

        // sync
        let syncResults = storage1.sync(storage2, { direction: 'push', existing: true, live: false });
        //log('sync results', syncResults);
        t.same(syncResults, { numPushed: 4, numPulled: 0 }, 'pushed 4 docs (includes history docs).  pulled 0.');

        // check results
        t.same(storage1.paths(), storage2.paths(), 'storage1.paths() == storage2.paths()');
        t.same(storage1.contents(), storage2.contents(), 'storage1 contents == storage2');
        t.same(storage1.contents({ includeHistory: true }), storage2.contents({ includeHistory: true }), 'storage1 contents with history == storage2');

        t.same(storage2.paths(), ['/decoy1', '/decoy2', '/path1'], 'paths are as expected');
        t.same(storage2.getContent('/path1'), 'two', 'latest doc for a path wins on storage2');
        t.same(storage2.getDocument('/path1')?.content, 'two', 'getDocument has correct content');
        t.same(storage2.contents(), ['aaa', 'zzz', 'two'], 'storage2 contents are as expected');
        t.same(storage2.contents({ includeHistory: true }), ['aaa', 'zzz', 'two', 'one'], 'contents with history are as expected');

        // sync again.  nothing should happen.
        let syncResults2 = storage1.sync(storage2, { direction: 'push', existing: true, live: false });
        //log('sync results 2', syncResults2);
        t.same(syncResults2, { numPushed: 0, numPulled: 0 }, 'nothing should happen if syncing again');

        t.done();
    });

    t.test(scenario.description + ': sync: two-way', (t: any) => {
        let optsToTry : SyncOpts[] = [
            {},  // use the defaults
            { direction: 'both', existing: true, live: false },  // these are the defaults
        ];

        for (let opts of optsToTry) {
            let storage1 = scenario.makeStorage(WORKSPACE);
            let storage2 = scenario.makeStorage(WORKSPACE);

            // set up some paths
            t.ok(storage1.set(keypair1, {format: FORMAT, path: '/decoy2', content: 'zzz', timestamp: now}), 'author1 set decoy path');  // winner  (push #1)
            t.ok(storage1.set(keypair1, {format: FORMAT, path: '/decoy1', content: 'aaa', timestamp: now}), 'author1 set decoy path');  // winner  (push 2)

            t.ok(storage1.set(keypair1, {format: FORMAT, path: '/path1', content: 'one', timestamp: now}), 'author1 set path1');      // becomes history  (push 3)
            t.ok(storage1.set(keypair2, {format: FORMAT, path: '/path1', content: 'two', timestamp: now + 1}), 'author2 set path1');  // winner  (push 4)

            t.ok(storage2.set(keypair1, {format: FORMAT, path: '/latestOnStorage1', content: '221', timestamp: now}));       // dropped
            t.ok(storage1.set(keypair1, {format: FORMAT, path: '/latestOnStorage1', content: '111', timestamp: now + 10}));  // winner  (push 5)

            t.ok(storage1.set(keypair1, {format: FORMAT, path: '/latestOnStorage2', content: '11', timestamp: now}));       // dropped
            t.ok(storage2.set(keypair1, {format: FORMAT, path: '/latestOnStorage2', content: '22', timestamp: now + 10}));  // winner  (pull 1)

            t.ok(storage1.set(keypair1, {format: FORMAT, path: '/authorConflict', content: 'author1storage1', timestamp: now}));      // becomes history  (push 6)
            t.ok(storage2.set(keypair2, {format: FORMAT, path: '/authorConflict', content: 'author2storage2', timestamp: now + 1}));  // winner  (pull 2)

            // sync
            let syncResults = storage1.sync(storage2, opts);
            //log('sync results', syncResults);
            t.same(syncResults, { numPushed: 6, numPulled: 2 }, 'pushed 6 docs, pulled 2 (including history)');

            logTest('=================================================');
            logTest('=================================================');
            logTest('=================================================');

            t.equal(storage1.paths().length, 6, '6 paths');
            t.equal(storage1.documents().length, 6, '6 docs');
            t.equal(storage1.documents({ includeHistory: true }).length, 8, '8 docs with history');
            t.equal(storage1.contents().length, 6, '6 contents');
            t.equal(storage1.contents({ includeHistory: true }).length, 8, '8 contents with history');

            t.same(storage1.paths(), '/authorConflict /decoy1 /decoy2 /latestOnStorage1 /latestOnStorage2 /path1'.split(' '), 'correct paths on storage1');
            t.same(storage1.contents(), 'author2storage2 aaa zzz 111 22 two'.split(' '), 'correct contents on storage1');

            t.same(storage1.paths(), storage2.paths(), 'paths match');
            t.same(storage1.documents(), storage2.documents(), 'docs match');
            t.same(storage1.documents({ includeHistory: true }), storage2.documents({ includeHistory: true }), 'docs with history: match');
            t.same(storage1.contents(), storage2.contents(), 'contents match');
            t.same(storage1.contents({ includeHistory: true }), storage2.contents({ includeHistory: true }), 'contents with history: match');
        }

        t.done();
    });

    t.test(scenario.description + ': sync: mismatched workspaces', (t: any) => {
        let storageA1 = scenario.makeStorage(WORKSPACE);
        let storageA2 = scenario.makeStorage(WORKSPACE);
        let storageB = scenario.makeStorage(WORKSPACE2);
        t.ok(storageA1.set(keypair1, {format: FORMAT, path: '/a1', content: 'a1'}));
        t.ok(storageA2.set(keypair1, {format: FORMAT, path: '/a2', content: 'a2'}));
        t.ok(storageB.set(keypair1, {format: FORMAT, path: '/b', content: 'b'}));

        t.same(storageA1.sync(storageB), { numPulled: 0, numPushed: 0}, 'sync across different workspaces should do nothing');
        t.same(storageA1.sync(storageA2), { numPulled: 1, numPushed: 1}, 'sync across matching workspaces should do something');

        t.done();
    });

    t.test(scenario.description + ': sync: misc other options', (t: any) => {
        let storageEmpty1 = scenario.makeStorage(WORKSPACE);
        let storageEmpty2 = scenario.makeStorage(WORKSPACE);
        let storage = scenario.makeStorage(WORKSPACE);

        // this time let's omit schema and timestamp
        t.ok(storage.set(keypair1, {format: FORMAT, path: '/foo', content: 'bar'}));

        // live mode (not implemented yet)
        t.throws(() => storageEmpty1.sync(storageEmpty2, {live: true}), 'live is not implemented yet and should throw');

        // sync with empty stores
        t.same(storageEmpty1.sync(storageEmpty2), { numPushed: 0, numPulled: 0 }, 'sync with empty stores');
        t.same(storageEmpty1.sync(storageEmpty2, {direction: 'push'}), { numPushed: 0, numPulled: 0 }, 'sync with empty stores');
        t.same(storageEmpty1.sync(storageEmpty2, {direction: 'pull'}), { numPushed: 0, numPulled: 0 }, 'sync with empty stores');
        t.same(storageEmpty1.sync(storageEmpty2, {direction: 'both'}), { numPushed: 0, numPulled: 0 }, 'sync with empty stores');
        t.same(storageEmpty1.sync(storageEmpty2, {existing: false}), { numPushed: 0, numPulled: 0 }, 'sync with empty stores');

        // sync with empty stores
        t.same(storage.sync(storageEmpty1, {direction: 'pull'}), { numPushed: 0, numPulled: 0 }, 'pull from empty store');
        t.same(storageEmpty1.sync(storage, {direction: 'push'}), { numPushed: 0, numPulled: 0 }, 'push to empty store');

        // sync with self
        t.same(storage.sync(storage), { numPushed: 0, numPulled: 0 }, 'sync with self should do nothing');

        // existing: false
        t.same(storage.sync(storageEmpty1, {existing: false}), { numPushed: 0, numPulled: 0 }, 'sync with existing: false does nothing');
        t.same(storageEmpty1.sync(storage, {existing: false}), { numPushed: 0, numPulled: 0 }, 'sync with existing: false does nothing');

        // successful sync
        t.same(storage.sync(storageEmpty1), { numPushed: 1, numPulled: 0 }, 'successful sync (push)');
        t.same(storageEmpty2.sync(storage), { numPushed: 0, numPulled: 1 }, 'successful sync (pull)');

        t.done();
    });

    t.test(scenario.description + ': onChange', (t: any) => {
        let storage = scenario.makeStorage(WORKSPACE);

        let numCalled = 0;
        let cb = () => { numCalled += 1; }
        let unsub = storage.onChange.subscribe(cb);

        t.ok(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1.0', timestamp: now}), 'set new path');
        t.notOk(storage.set(keypair1, {format: 'xxx', path: '/path1', content: 'val1.1', timestamp: now}), 'invalid set that will be ignored');
        t.equal(storage.getContent('/path1'), 'val1.0', 'second set was ignored');

        t.equal(numCalled, 1, 'callback was called once');
        unsub();

        t.ok(storage.set(keypair1, {format: FORMAT, path: '/path2', content: 'val2.0', timestamp: now + 1}), 'set another path');

        t.equal(numCalled, 1, 'callback was not called after unsubscribing');

        t.done();
    });

}
