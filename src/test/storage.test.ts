import * as fs from 'fs';
import t = require('tap');
//t.runOnly = true;

import {
    AuthorAddress,
    Document,
    FormatName,
    IStorage,
    IValidator,
    SyncOpts,
} from '../util/types';
import {
    generateAuthorKeypair
} from '../crypto/crypto';
import { ValidatorEs2 } from '../validator/es2';
import { StorageMemory } from '../storage/memory';
import { StorageSqlite } from '../storage/sqlite';

let log = console.log;

//================================================================================
// prepare for test scenarios

let WORKSPACE = '//gardenclub.xxxxxxxxxxxxxxxxxxxx';
let WORKSPACE2 = '//another.xxxxxxxxxxxxxxxxxxxx';

let FORMAT : FormatName = 'es.2';
let VALIDATORS : IValidator[] = [ValidatorEs2];

let keypair1 = generateAuthorKeypair('test');
let keypair2 = generateAuthorKeypair('twoo');
let keypair3 = generateAuthorKeypair('thre');
let author1: AuthorAddress = keypair1.address;
let author2: AuthorAddress = keypair2.address;
let author3: AuthorAddress = keypair3.address;
let now = 1500000000000000;

interface Scenario {
    makeStore: (workspace : string) => IStorage,
    description: string,
}
let scenarios : Scenario[] = [
    //{
    //    makeStore: (workspace : string) : IStorage => new StorageMemory(VALIDATORS, workspace),
    //    description: 'StoreMemory',
    //},
    {
        makeStore: (workspace : string) : IStorage => new StorageSqlite({
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
    let es = new StorageSqlite({
        mode: 'create',
        workspace: WORKSPACE,
        validators: VALIDATORS,
        filename: ':memory:'
    });
    t.equal(es._getConfig('foo'), null);
    es._setConfig('foo', 'bar');
    t.equal(es._getConfig('foo'), 'bar');
    es._setConfig('foo', 'baz');
    t.equal(es._getConfig('foo'), 'baz');
    t.done();
});


//================================================================================
// run the standard store tests on each scenario

for (let scenario of scenarios) {
    t.test(`==== starting test of ====${scenario.description}`, (t: any) => {
        t.done();
    });

    t.test(scenario.description + ': empty store', (t: any) => {
        let es = scenario.makeStore(WORKSPACE);
        t.same(es.paths(), [], 'no keys');
        t.same(es.documents(), [], 'no docs');
        t.same(es.values(), [], 'no values');
        t.equal(es.getDocument('xxx'), undefined, 'getDocument undefined');
        t.equal(es.getValue('xxx'), undefined, 'getValue undefined');
        t.same(es.authors(), [], 'no authors');
        t.done();
    });

    t.test(scenario.description + ': store ingestDocument rejects invalid docs', (t: any) => {
        let es = scenario.makeStore(WORKSPACE);

        let doc1: Document = {
            format: FORMAT,
            workspace: WORKSPACE,
            path: '/k1',
            value: 'v1',
            timestamp: now,
            author: author1,
            signature: 'xxx',
        };
        let signedDoc = ValidatorEs2.signDocument(keypair1, doc1);
        t.ok(es.ingestDocument(signedDoc), "successful ingestion");
        t.equal(es.getValue('/k1'), 'v1', "getValue worked");

        t.notOk(es.ingestDocument(doc1), "don't ingest: bad signature");
        t.notOk(es.ingestDocument({...signedDoc, format: 'xxx'}), "don't ingest: unknown format");
        t.notOk(es.ingestDocument({...signedDoc, timestamp: now / 1000}), "don't ingest: timestamp too small, probably in milliseconds");
        t.notOk(es.ingestDocument({...signedDoc, timestamp: now * 2}), "don't ingest: timestamp in future");
        t.notOk(es.ingestDocument({...signedDoc, timestamp: Number.MAX_SAFE_INTEGER * 2}), "don't ingest: timestamp way too large");
        t.notOk(es.ingestDocument({...signedDoc, workspace: 'xxx'}), "don't ingest: changed workspace after signing");

        let signedDocDifferentWorkspace = ValidatorEs2.signDocument(keypair1, {...doc1, workspace: 'xxx'});
        t.notOk(es.ingestDocument(signedDocDifferentWorkspace), "don't ingest: mismatch workspace");

        t.notOk(es.set(keypair1, {
            format: 'xxx',
            path: '/k1',
            value: 'v1',
        }), 'set rejects unknown format');

        let writableKeys = [
            '/hello',
            '/~' + author1 + '/about',
            '/chat/~@notme.ed25519~' + author1,
        ];
        for (let key of writableKeys) {
            t.ok(es.ingestDocument(
                ValidatorEs2.signDocument(
                    keypair1,
                    {...doc1, path: key}
                )),
                "do ingest: writable key " + key
            );
        }
        let notWritableKeys = [
            '/~@notme.ed25519/about',
            '/~',
        ];
        for (let key of notWritableKeys) {
            t.notOk(es.ingestDocument(
                ValidatorEs2.signDocument(
                    keypair1,
                    {...doc1, path: key}
                )),
                "don't ingest: non-writable key " + key
            );
        }

        t.done();
    });

    t.test(scenario.description + ': one-author store', (t: any) => {
        let es = scenario.makeStore(WORKSPACE);
        t.equal(es.getValue('/path1'), undefined, 'nonexistant paths are undefined');
        t.equal(es.getValue('/path2'), undefined, 'nonexistant paths are undefined');

        // set a decoy path to make sure the later tests return the correct path
        t.ok(es.set(keypair1, {format: FORMAT, path: '/decoy', value:'zzz', timestamp: now}), 'set decoy path');

        t.ok(es.set(keypair1, {format: FORMAT, path: '/path1', value: 'val1.0', timestamp: now}), 'set new path');
        t.equal(es.getValue('/path1'), 'val1.0');

        t.ok(es.set(keypair1, {format: FORMAT, path: '/path1', value: 'val1.2', timestamp: now + 2}), 'overwrite path with newer time');
        t.equal(es.getValue('/path1'), 'val1.2');

        // write with an old timestamp - this timestamp should be overridden to the existing timestamp + 1.
        // note that on ingest() the newer timestamp wins, but on set() we adjust the newly created timestamp
        // so it's always greater than the existing ones.
        t.ok(es.set(keypair1, {format: FORMAT, path: '/path1', value: 'val1.1', timestamp: now-99}), 'automatically supercede previous timestamp');
        t.equal(es.getValue('/path1'), 'val1.1', 'superceded newer existing value');
        t.equal(es.getDocument('/path1')?.timestamp, now + 3, 'timestamp was superceded by 1 microsecond');

        // should be alphabetical
        t.same(es.paths(), ['/decoy', '/path1'], 'paths() are correct');

        // order of values should match order of paths
        t.same(es.values(), ['zzz', 'val1.1'], 'values() are correct');

        t.same(es.authors(), [author1], 'author');

        t.done();
    });

    t.test(scenario.description + ': path queries', (t: any) => {
        let es = scenario.makeStore(WORKSPACE);
        let paths = '/zzz /aaa /dir /dir/ /q /qq /qqq /dir/a /dir/b /dir/c'.split(' ');
        let ii = 0;
        for (let path of paths) {
            t.ok(es.set(keypair1, {format: FORMAT, path: path, value: 'true', timestamp: now + ii}), 'set path: ' + path),
                ii += 1;
        }
        let sortedPaths = [...paths];
        sortedPaths.sort();
        let esPaths = es.paths();
        t.same(paths.length, esPaths.length, 'same number of paths');
        t.same(sortedPaths, esPaths, 'paths are sorted');
        t.same(es.paths({ path: '/q' }), ['/q'], 'query for specific path');
        t.same(es.paths({ path: '/nope' }), [], 'query for missing path');
        t.same(es.paths({ lowPath: '/q', highPath: '/qqq' }), ['/q', '/qq'], 'lowPath <= k < highPath');
        t.same(es.paths({ lowPath: '/q', highPath: '/qqq', limit: 1 }), ['/q'], 'lowPath, highPath with limit');
        t.same(es.paths({ pathPrefix: '/dir/' }), ['/dir/', '/dir/a', '/dir/b', '/dir/c'], 'pathPrefix');
        t.same(es.paths({ pathPrefix: '/dir/', limit: 2 }), ['/dir/', '/dir/a'], 'pathPrefix with limit');
        t.done();
    });

    t.test(scenario.description + ': limits on queries', (t: any) => {
        let es = scenario.makeStore(WORKSPACE);

        // three authors
        t.ok(es.set(keypair1, {format: FORMAT, path: '/foo', value: 'foo', timestamp: now}), 'set data');
        t.ok(es.set(keypair1, {format: FORMAT, path: '/pathA', value: 'value1', timestamp: now + 1}), 'set data');
        t.ok(es.set(keypair2, {format: FORMAT, path: '/pathA', value: 'value2', timestamp: now + 2}), 'set data');
        t.ok(es.set(keypair3, {format: FORMAT, path: '/pathA', value: 'value3', timestamp: now + 3}), 'set data');

        t.same(es.authors(), [author1, author3, author2], 'authors');

        // queries with limits
        t.same(es.paths( { includeHistory: true }), ['/foo', '/pathA'], 'paths with history, no limit');
        t.same(es.values({ includeHistory: true }), ['foo', 'value3', 'value2', 'value1'], 'values with history, no limit');

        t.same(es.paths( { includeHistory: true, limit: 1 }), ['/foo'], 'paths with history, limit 1');
        t.same(es.values({ includeHistory: true, limit: 1 }), ['foo'], 'values with history, limit 1');

        t.same(es.paths( { includeHistory: true, limit: 2 }), ['/foo', '/pathA'], 'paths with history, limit 2');
        t.same(es.values({ includeHistory: true, limit: 2 }), ['foo', 'value3'], 'values with history, limit 2');

        t.same(es.paths( { includeHistory: true, limit: 3 }), ['/foo', '/pathA'], 'paths with history, limit 3');
        t.same(es.values({ includeHistory: true, limit: 3 }), ['foo', 'value3', 'value2'], 'values with history, limit 3');
        
        // no history
        t.same(es.paths( { includeHistory: false }), ['/foo', '/pathA'], 'paths no history, no limit');
        t.same(es.values({ includeHistory: false }), ['foo', 'value3'], 'values no history, no limit');

        t.same(es.paths( { includeHistory: false, limit: 1 }), ['/foo'], 'paths no history, limit 1');
        t.same(es.values({ includeHistory: false, limit: 1 }), ['foo'], 'values no history, limit 1');

        t.done();
    });

    t.only(scenario.description + ': path and author queries', (t: any) => {
        let es = scenario.makeStore(WORKSPACE);

        // two authors
        t.ok(es.set(keypair1, {format: FORMAT, path: '/pathA', value: 'value1.X', timestamp: now + 1}), 'set data');
        t.ok(es.set(keypair2, {format: FORMAT, path: '/pathA', value: 'value2.Y', timestamp: now + 2}), 'set data');
        t.ok(es.set(keypair1, {format: FORMAT, path: '/pathA', value: 'value1.Z', timestamp: now + 3}), 'set data');

        log('==============================================');
        log('==============================================');
        log('==============================================');
        t.same(es.authors(), [author1, author2], 'authors');

        // path queries
        //t.same(es.paths(    { path: '/pathA', includeHistory: false }), ['/pathA'], 'paths with path query');
        //t.same(es.values(   { path: '/pathA', includeHistory: false }), ['value1.Z'], 'values with path query');
        //t.same(es.documents({ path: '/pathA', includeHistory: false }).map(d => d.value), ['value1.Z'], 'documents with path query');

        //t.same(es.paths(    { path: '/pathA', includeHistory: true }), ['/pathA'], 'paths with path query, history');
        //t.same(es.values(   { path: '/pathA', includeHistory: true }), ['value1.Z', 'value2.Y'], 'values with path query, history');
        //t.same(es.documents({ path: '/pathA', includeHistory: true }).map(d => d.value), ['value1.Z', 'value2.Y'], 'documents with path query, history');

        log('==============================================');
        log('==============================================');
        log('==============================================');
        //// versionsByAuthor
        t.same(es.paths({ versionsByAuthor: author1, includeHistory: true }), ['/pathA'], 'paths versionsByAuthor 1, no history');
        //t.same(es.paths({ versionsByAuthor: author1, includeHistory: false }), ['/pathA'], 'paths versionsByAuthor 1, no history');
        //t.same(es.paths({ versionsByAuthor: author2, includeHistory: true }), ['/pathA'], 'paths versionsByAuthor 2, with history');
        //t.same(es.paths({ versionsByAuthor: author2, includeHistory: false }), [], 'paths versionsByAuthor 2, with history');
        //t.same(es.values({ versionsByAuthor: author1, includeHistory: true }), ['value1.Z'], 'values versionsByAuthor 1, no history');
        //t.same(es.values({ versionsByAuthor: author1, includeHistory: false }), ['value1.Z'], 'values versionsByAuthor 1, no history');
        //t.same(es.values({ versionsByAuthor: author2, includeHistory: true }), ['value2.Y'], 'values versionsByAuthor 2, with history');
        //t.same(es.values({ versionsByAuthor: author2, includeHistory: false }), [], 'values versionsByAuthor 2, with history');
        //t.same(es.documents({ versionsByAuthor: author1, includeHistory: true }).length, 1, 'documents versionsByAuthor 1, no history');
        //t.same(es.documents({ versionsByAuthor: author1, includeHistory: false }).length, 1, 'documents versionsByAuthor 1, no history');
        //t.same(es.documents({ versionsByAuthor: author2, includeHistory: true }).length, 1, 'documents versionsByAuthor 2, with history');
        //t.same(es.documents({ versionsByAuthor: author2, includeHistory: false }).length, 0, 'documents versionsByAuthor 2, with history');

        //// participatingAuthor
        //t.same(es.values({ participatingAuthor: author1, includeHistory: true }), ['value1.Z', 'value2.Y'], 'participatingAuthor 1, with history');
        //t.same(es.values({ participatingAuthor: author1, includeHistory: false }), ['value1.Z'], 'participatingAuthor 1, no history');
        //t.same(es.values({ participatingAuthor: author2, includeHistory: true }), ['value1.Z', 'value2.Y'], 'participatingAuthor 2, with history');
        //t.same(es.values({ participatingAuthor: author2, includeHistory: false }), ['value1.Z'], 'participatingAuthor 2, no history');

        t.done();
    });

    t.test(scenario.description + ': multi-author writes', (t: any) => {
        let es = scenario.makeStore(WORKSPACE);

        // set decoy paths to make sure the later tests return the correct path
        t.ok(es.set(keypair1, {format: FORMAT, path: '/decoy2', value: 'zzz', timestamp: now}), 'set decoy path 2');
        t.ok(es.set(keypair1, {format: FORMAT, path: '/decoy1', value: 'aaa', timestamp: now}), 'set decoy path 1');

        t.ok(es.set(keypair1, {format: FORMAT, path: '/path1', value: 'one', timestamp: now}), 'set new path');
        t.equal(es.getValue('/path1'), 'one');

        // this will overwrite 'one' but the doc for 'one' will remain in history.
        // history will have 2 docs for this path.
        t.ok(es.set(keypair2, {format: FORMAT, path: '/path1', value: 'two', timestamp: now + 1}), 'update from a second author');
        t.equal(es.getValue('/path1'), 'two');

        // this will replace the old original doc 'one' from this author.
        // history will have 2 docs for this path.
        t.ok(es.set(keypair1, {format: FORMAT, path: '/path1', value: 'three', timestamp: now + 2}), 'update from original author again');
        t.equal(es.getValue('/path1'), 'three');

        t.equal(es.paths().length, 3, '3 paths');
        t.equal(es.values().length, 3, '3 values');
        t.equal(es.values({ includeHistory: true }).length, 4, '4 values with history');

        t.same(es.paths(), ['/decoy1', '/decoy2', '/path1'], 'paths()');
        t.same(es.values(), ['aaa', 'zzz', 'three'], 'values()');
        t.same(es.values({ includeHistory: true }), ['aaa', 'zzz', 'three', 'two'], 'values with history, newest first');

        t.same(
            es.documents({ includeHistory: true }).map((doc : Document) => doc.author),
            [author1, author1, author1, author2],
            'docs with history, newest first, docs should have correct authors'
        );

        let sortedAuthors = [author1, author2];
        sortedAuthors.sort();
        t.same(es.authors(), sortedAuthors, 'authors');

        // TODO: test 2 authors, same timestamps, different signatures

        t.done();
    });

    t.test(scenario.description + ': sync: push to empty store', (t: any) => {
        let es1 = scenario.makeStore(WORKSPACE);
        let es2 = scenario.makeStore(WORKSPACE);

        // set up some paths
        t.ok(es1.set(keypair1, {format: FORMAT, path: '/decoy2', value: 'zzz', timestamp: now}), 'author1 set decoy path');
        t.ok(es1.set(keypair1, {format: FORMAT, path: '/decoy1', value: 'aaa', timestamp: now}), 'author1 set decoy path');
        t.ok(es1.set(keypair1, {format: FORMAT, path: '/path1', value: 'one', timestamp: now}), 'author1 set path1');
        t.ok(es1.set(keypair2, {format: FORMAT, path: '/path1', value: 'two', timestamp: now + 1}), 'author2 set path1');

        // sync
        let syncResults = es1.sync(es2, { direction: 'push', existing: true, live: false });
        //log('sync results', syncResults);
        t.same(syncResults, { numPushed: 4, numPulled: 0 }, 'pushed 4 docs (includes history docs).  pulled 0.');

        // check results
        t.same(es1.paths(), es2.paths(), 'es1.paths() == es2.paths()');
        t.same(es1.values(), es2.values(), 'es1 values == es2');
        t.same(es1.values({ includeHistory: true }), es2.values({ includeHistory: true }), 'es1 values with history == es2');

        t.same(es2.paths(), ['/decoy1', '/decoy2', '/path1'], 'paths are as expected');
        t.same(es2.getValue('/path1'), 'two', 'latest doc for a path wins on es2');
        t.same(es2.getDocument('/path1')?.value, 'two', 'getDocument has correct value');
        t.same(es2.values(), ['aaa', 'zzz', 'two'], 'es2 values are as expected');
        t.same(es2.values({ includeHistory: true }), ['aaa', 'zzz', 'two', 'one'], 'values with history are as expected');

        // sync again.  nothing should happen.
        let syncResults2 = es1.sync(es2, { direction: 'push', existing: true, live: false });
        //log('sync results 2', syncResults2);
        t.same(syncResults2, { numPushed: 0, numPulled: 0 }, 'nothing should happen if syncing again');

        t.done();
    });

    t.test(scenario.description + ': sync: two-way', (t: any) => {
        let optsToTry : SyncOpts[] = [
            {},  // use the defaults
            //{ direction: 'both', existing: true, live: false },  // these are the defaults
        ];

        for (let opts of optsToTry) {
            let es1 = scenario.makeStore(WORKSPACE);
            let es2 = scenario.makeStore(WORKSPACE);

            // set up some paths
            t.ok(es1.set(keypair1, {format: FORMAT, path: '/decoy2', value: 'zzz', timestamp: now}), 'author1 set decoy path');  // winner  (push #1)
            t.ok(es1.set(keypair1, {format: FORMAT, path: '/decoy1', value: 'aaa', timestamp: now}), 'author1 set decoy path');  // winner  (push 2)

            t.ok(es1.set(keypair1, {format: FORMAT, path: '/path1', value: 'one', timestamp: now}), 'author1 set path1');      // becomes history  (push 3)
            t.ok(es1.set(keypair2, {format: FORMAT, path: '/path1', value: 'two', timestamp: now + 1}), 'author2 set path1');  // winner  (push 4)

            t.ok(es2.set(keypair1, {format: FORMAT, path: '/latestOnEs1', value: '221', timestamp: now}));       // dropped
            t.ok(es1.set(keypair1, {format: FORMAT, path: '/latestOnEs1', value: '111', timestamp: now + 10}));  // winner  (push 5)

            t.ok(es1.set(keypair1, {format: FORMAT, path: '/latestOnEs2', value: '11', timestamp: now}));       // dropped
            t.ok(es2.set(keypair1, {format: FORMAT, path: '/latestOnEs2', value: '22', timestamp: now + 10}));  // winner  (pull 1)

            t.ok(es1.set(keypair1, {format: FORMAT, path: '/authorConflict', value: 'author1es1', timestamp: now}));      // becomes history  (push 6)
            t.ok(es2.set(keypair2, {format: FORMAT, path: '/authorConflict', value: 'author2es2', timestamp: now + 1}));  // winner  (pull 2)

            // sync
            let syncResults = es1.sync(es2, opts);
            //log('sync results', syncResults);
            t.same(syncResults, { numPushed: 6, numPulled: 2 }, 'pushed 6 docs, pulled 2 (including history)');

            log('=================================================');
            log('=================================================');
            log('=================================================');

            t.equal(es1.paths().length, 6, '6 paths');
            t.equal(es1.documents().length, 6, '6 docs');
            t.equal(es1.documents({ includeHistory: true }).length, 8, '8 docs with history');
            t.equal(es1.values().length, 6, '6 values');
            t.equal(es1.values({ includeHistory: true }).length, 8, '8 values with history');

            t.same(es1.paths(), '/authorConflict /decoy1 /decoy2 /latestOnEs1 /latestOnEs2 /path1'.split(' '), 'correct paths on es1');
            t.same(es1.values(), 'author2es2 aaa zzz 111 22 two'.split(' '), 'correct values on es1');

            t.same(es1.paths(), es2.paths(), 'paths match');
            t.same(es1.documents(), es2.documents(), 'docs match');
            t.same(es1.documents({ includeHistory: true }), es2.documents({ includeHistory: true }), 'docs with history: match');
            t.same(es1.values(), es2.values(), 'values match');
            t.same(es1.values({ includeHistory: true }), es2.values({ includeHistory: true }), 'values with history: match');
        }

        t.done();
    });

    t.test(scenario.description + ': sync: mismatched workspaces', (t: any) => {
        let esA1 = scenario.makeStore(WORKSPACE);
        let esA2 = scenario.makeStore(WORKSPACE);
        let esB = scenario.makeStore(WORKSPACE2);
        t.ok(esA1.set(keypair1, {format: FORMAT, path: '/a1', value: 'a1'}));
        t.ok(esA2.set(keypair1, {format: FORMAT, path: '/a2', value: 'a2'}));
        t.ok(esB.set(keypair1, {format: FORMAT, path: '/b', value: 'b'}));

        t.same(esA1.sync(esB), { numPulled: 0, numPushed: 0}, 'sync across different workspaces should do nothing');
        t.same(esA1.sync(esA2), { numPulled: 1, numPushed: 1}, 'sync across matching workspaces should do something');

        t.done();
    });

    t.test(scenario.description + ': sync: misc other options', (t: any) => {
        let esEmpty1 = scenario.makeStore(WORKSPACE);
        let esEmpty2 = scenario.makeStore(WORKSPACE);
        let es = scenario.makeStore(WORKSPACE);

        // this time let's omit schema and timestamp
        t.ok(es.set(keypair1, {format: FORMAT, path: '/foo', value: 'bar'}));

        // live mode (not implemented yet)
        t.throws(() => esEmpty1.sync(esEmpty2, {live: true}), 'live is not implemented yet and should throw');

        // sync with empty stores
        t.same(esEmpty1.sync(esEmpty2), { numPushed: 0, numPulled: 0 }, 'sync with empty stores');
        t.same(esEmpty1.sync(esEmpty2, {direction: 'push'}), { numPushed: 0, numPulled: 0 }, 'sync with empty stores');
        t.same(esEmpty1.sync(esEmpty2, {direction: 'pull'}), { numPushed: 0, numPulled: 0 }, 'sync with empty stores');
        t.same(esEmpty1.sync(esEmpty2, {direction: 'both'}), { numPushed: 0, numPulled: 0 }, 'sync with empty stores');
        t.same(esEmpty1.sync(esEmpty2, {existing: false}), { numPushed: 0, numPulled: 0 }, 'sync with empty stores');

        // sync with empty stores
        t.same(es.sync(esEmpty1, {direction: 'pull'}), { numPushed: 0, numPulled: 0 }, 'pull from empty store');
        t.same(esEmpty1.sync(es, {direction: 'push'}), { numPushed: 0, numPulled: 0 }, 'push to empty store');

        // sync with self
        t.same(es.sync(es), { numPushed: 0, numPulled: 0 }, 'sync with self should do nothing');

        // existing: false
        t.same(es.sync(esEmpty1, {existing: false}), { numPushed: 0, numPulled: 0 }, 'sync with existing: false does nothing');
        t.same(esEmpty1.sync(es, {existing: false}), { numPushed: 0, numPulled: 0 }, 'sync with existing: false does nothing');

        // successful sync
        t.same(es.sync(esEmpty1), { numPushed: 1, numPulled: 0 }, 'successful sync (push)');
        t.same(esEmpty2.sync(es), { numPushed: 0, numPulled: 1 }, 'successful sync (pull)');

        t.done();
    });

    t.test(scenario.description + ': onChange', (t: any) => {
        let es = scenario.makeStore(WORKSPACE);

        let numCalled = 0;
        let cb = () => { numCalled += 1; }
        let unsub = es.onChange.subscribe(cb);

        t.ok(es.set(keypair1, {format: FORMAT, path: '/path1', value: 'val1.0', timestamp: now}), 'set new path');
        t.notOk(es.set(keypair1, {format: 'xxx', path: '/path1', value: 'val1.1', timestamp: now}), 'invalid set that will be ignored');
        t.equal(es.getValue('/path1'), 'val1.0', 'second set was ignored');

        t.equal(numCalled, 1, 'callback was called once');
        unsub();

        t.ok(es.set(keypair1, {format: FORMAT, path: '/path2', value: 'val2.0', timestamp: now + 1}), 'set another path');

        t.equal(numCalled, 1, 'callback was not called after unsubscribing');

        t.done();
    });
}