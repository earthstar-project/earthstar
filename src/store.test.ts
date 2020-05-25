import t = require('tap');
import { addSigilToKey, generateKeypair } from './crypto';
import { SyncOpts, Item, CodecName, AuthorKey, IStore, ICodec } from './types';
import { CodecKw1 } from "./codecs";
import { StoreMemory } from './storeMemory';
import { StoreSqlite } from './storeSqlite';

//================================================================================
// prepare for test scenarios

let WORKSPACE = 'gardenclub';
let CODECS : ICodec[] = [CodecKw1];
let CODEC : CodecName = 'kw.1';

let keypair1 = generateKeypair();
let keypair2 = generateKeypair();
let keypair3 = generateKeypair();
let author1: AuthorKey = addSigilToKey(keypair1.public);
let author2: AuthorKey = addSigilToKey(keypair2.public);
let author3: AuthorKey = addSigilToKey(keypair3.public);
let now = 1500000000000000;

let scenarios = [
    {
        constructor: () : IStore => new StoreMemory(CODECS, WORKSPACE),
        description: 'StoreMemory',
    },
    {
        constructor: () : IStore => new StoreSqlite(CODECS, WORKSPACE, ':memory:'),
        description: "StoreSqlite(':memory:')",
    },
];

//================================================================================
// run the scenarios

for (let scenario of scenarios) {
    t.test(`==== starting test of ====${scenario.description}`, (t: any) => {
        t.done();
    });

    t.test(scenario.description + ': empty store', (t: any) => {
        let kw = scenario.constructor();
        t.same(kw.keys(), [], 'no keys');
        t.same(kw.items(), [], 'no items');
        t.same(kw.values(), [], 'no values');
        t.equal(kw.getItem('xxx'), undefined, 'getItem undefined');
        t.equal(kw.getValue('xxx'), undefined, 'getValue undefined');
        t.done();
    });

    t.test(scenario.description + ': store rejects invalid items', (t: any) => {
        let kw = scenario.constructor();

        let item1: Item = {
            codec: CODEC,
            workspace: WORKSPACE,
            key: 'k1',
            value: 'v1',
            timestamp: now,
            author: author1,
            signature: 'xxx',
        };
        let signedItem = CodecKw1.signItem(item1, keypair1.secret);

        t.notOk(kw.ingestItem(item1), "don't ingest: bad signature");
        t.notOk(kw.ingestItem({...signedItem, timestamp: now / 1000}), "don't ingest: timestamp too small, probably in milliseconds");
        t.notOk(kw.ingestItem({...signedItem, timestamp: now * 2}), "don't ingest: timestamp in future");
        t.notOk(kw.ingestItem({...signedItem, timestamp: Number.MAX_SAFE_INTEGER * 2}), "don't ingest: timestamp way too large");
        t.notOk(kw.ingestItem({...signedItem, workspace: 'xxx'}), "don't ingest: changed workspace after signing");

        let signedItemDifferentWorkspace = CodecKw1.signItem({...item1, workspace: 'xxx'}, keypair1.secret);
        t.notOk(kw.ingestItem(signedItemDifferentWorkspace), "don't ingest: mismatch workspace");

        t.ok(kw.ingestItem(signedItem), "successful ingestion");
        t.equal(kw.getValue('k1'), 'v1', "getValue worked");

        t.done();
    });

    t.test(scenario.description + ': one-author store', (t: any) => {
        let kw = scenario.constructor();
        t.equal(kw.getValue('key1'), undefined, 'nonexistant keys are undefined');
        t.equal(kw.getValue('key2'), undefined, 'nonexistant keys are undefined');

        // set a decoy key to make sure the later tests return the correct key
        t.ok(kw.set({codec: CODEC, key: 'decoy', value:'zzz', author: author1, authorSecret: keypair1.secret, timestamp: now}), 'set decoy key');

        t.ok(kw.set({codec: CODEC, key: 'key1', value: 'val1.0', author: author1, authorSecret: keypair1.secret, timestamp: now}), 'set new key');
        t.equal(kw.getValue('key1'), 'val1.0');

        t.ok(kw.set({codec: CODEC, key: 'key1', value: 'val1.2', author: author1, authorSecret: keypair1.secret, timestamp: now + 2}), 'overwrite key with newer time');
        t.equal(kw.getValue('key1'), 'val1.2');

        // write with an old timestamp - this timestamp should be overridden to the existing timestamp + 1.
        // note that on ingest() the newer timestamp wins, but on set() we adjust the newly created timestamp
        // so it's always greater than the existing ones.
        t.ok(kw.set({codec: CODEC, key: 'key1', value: 'val1.1', author: author1, authorSecret: keypair1.secret, timestamp: now-99}), 'automatically supercede previous timestamp');
        t.equal(kw.getValue('key1'), 'val1.1', 'superceded newer existing value');
        t.equal(kw.getItem('key1')?.timestamp, now + 3, 'timestamp was superceded by 1 microsecond');

        //log('_items:', JSON.stringify(kw._items, null, 4));

        // should be alphabetical
        t.same(kw.keys(), ['decoy', 'key1'], 'keys() are correct');

        // order of values should match order of keys
        t.same(kw.values(), ['zzz', 'val1.1'], 'values() are correct');

        t.done();
    });

    t.test(scenario.description + ': key queries', (t: any) => {
        let kw = scenario.constructor();
        let keys = 'zzz aaa dir dir/ q qq qqq dir/a dir/b dir/c'.split(' ');
        let ii = 0;
        for (let key of keys) {
            t.ok(kw.set({codec: CODEC, key: key, value: 'true', author: author1, authorSecret: keypair1.secret, timestamp: now + ii}), 'set key: ' + key),
                ii += 1;
        }
        let sortedKeys = [...keys];
        sortedKeys.sort();
        let kwKeys = kw.keys();
        t.same(keys.length, kwKeys.length, 'same number of keys');
        t.same(sortedKeys, kwKeys, 'keys are sorted');
        t.same(kw.keys({ key: 'q' }), ['q'], 'query for specific key');
        t.same(kw.keys({ key: 'nope' }), [], 'query for missing key');
        t.same(kw.keys({ lowKey: 'q', highKey: 'qqq' }), ['q', 'qq'], 'lowKey <= k < highKey');
        t.same(kw.keys({ lowKey: 'q', highKey: 'qqq', limit: 1 }), ['q'], 'lowKey, highKey with limit');
        t.same(kw.keys({ prefix: 'dir/' }), ['dir/', 'dir/a', 'dir/b', 'dir/c'], 'prefix');
        t.same(kw.keys({ prefix: 'dir/', limit: 2 }), ['dir/', 'dir/a'], 'prefix with limit');
        t.done();
    });

    t.test(scenario.description + ': multi-author writes', (t: any) => {
        let kw = scenario.constructor();

        // set decoy keys to make sure the later tests return the correct key
        t.ok(kw.set({codec: CODEC, key: 'decoy2', value: 'zzz', author: author1, authorSecret: keypair1.secret, timestamp: now}), 'set decoy key 2');
        t.ok(kw.set({codec: CODEC, key: 'decoy1', value: 'aaa', author: author1, authorSecret: keypair1.secret, timestamp: now}), 'set decoy key 1');

        t.ok(kw.set({codec: CODEC, key: 'key1', value: 'one', author: author1, authorSecret: keypair1.secret, timestamp: now}), 'set new key');
        t.equal(kw.getValue('key1'), 'one');

        // this will overwrite 'one' but the item for 'one' will remain in history.
        // history will have 2 items for this key.
        t.ok(kw.set({codec: CODEC, key: 'key1', value: 'two', author: author2, authorSecret: keypair2.secret, timestamp: now + 1}), 'update from a second author');
        t.equal(kw.getValue('key1'), 'two');

        // this will replace the old original item 'one' from this author.
        // history will have 2 items for this key.
        t.ok(kw.set({codec: CODEC, key: 'key1', value: 'three', author: author1, authorSecret: keypair1.secret, timestamp: now + 2}), 'update from original author again');
        t.equal(kw.getValue('key1'), 'three');

        //log('_items:', JSON.stringify(kw._items, null, 4));

        t.equal(kw.keys().length, 3, '3 keys');
        t.equal(kw.values().length, 3, '3 values');
        t.equal(kw.values({ includeHistory: true }).length, 4, '4 values with history');

        t.same(kw.keys(), ['decoy1', 'decoy2', 'key1'], 'keys()');
        t.same(kw.values(), ['aaa', 'zzz', 'three'], 'values()');
        t.same(kw.values({ includeHistory: true }), ['aaa', 'zzz', 'three', 'two'], 'values with history, newest first');

        t.same(
            kw.items({ includeHistory: true }).map((item : Item) => item.author),
            [author1, author1, author1, author2],
            'items with history, newest first, items should have correct authors'
        );

        // TODO: test 2 authors, same timestamps, different signatures

        t.done();
    });

    t.test(scenario.description + ': sync: push to empty store', (t: any) => {
        let kw1 = scenario.constructor();
        let kw2 = scenario.constructor();

        // set up some keys
        t.ok(kw1.set({codec: CODEC, key: 'decoy2', value: 'zzz', author: author1, authorSecret: keypair1.secret, timestamp: now}), 'author1 set decoy key');
        t.ok(kw1.set({codec: CODEC, key: 'decoy1', value: 'aaa', author: author1, authorSecret: keypair1.secret, timestamp: now}), 'author1 set decoy key');
        t.ok(kw1.set({codec: CODEC, key: 'key1', value: 'one', author: author1, authorSecret: keypair1.secret, timestamp: now}), 'author1 set key1');
        t.ok(kw1.set({codec: CODEC, key: 'key1', value: 'two', author: author2, authorSecret: keypair2.secret, timestamp: now + 1}), 'author2 set key1');

        // sync
        let syncResults = kw1.sync(kw2, { direction: 'push', existing: true, live: false });
        //log('sync results', syncResults);
        t.same(syncResults, { numPushed: 4, numPulled: 0 }, 'pushed 4 items (includes history items).  pulled 0.');

        // check results
        t.same(kw1.keys(), kw2.keys(), 'kw1.keys() == kw2.keys()');
        t.same(kw1.values(), kw2.values(), 'kw1 values == kw2');
        t.same(kw1.values({ includeHistory: true }), kw2.values({ includeHistory: true }), 'kw1 values with history == kw2');

        t.same(kw2.keys(), ['decoy1', 'decoy2', 'key1'], 'keys are as expected');
        t.same(kw2.getValue('key1'), 'two', 'latest item for a key wins on kw2');
        t.same(kw2.getItem('key1')?.value, 'two', 'getItem has correct value');
        t.same(kw2.values(), ['aaa', 'zzz', 'two'], 'kw2 values are as expected');
        t.same(kw2.values({ includeHistory: true }), ['aaa', 'zzz', 'two', 'one'], 'values with history are as expected');

        // sync again.  nothing should happen.
        let syncResults2 = kw1.sync(kw2, { direction: 'push', existing: true, live: false });
        //log('sync results 2', syncResults2);
        t.same(syncResults2, { numPushed: 0, numPulled: 0 }, 'nothing should happen if syncing again');

        //log('kw1._items:', JSON.stringify(kw1._items, null, 4));
        //log('kw1.keys()', kw1.keys());
        //log('kw1.values()', kw1.values());
        //log('kw1.getItem("key1")', kw1.getItem('key1'));

        t.done();
    });

    t.test(scenario.description + ': sync: two-way', (t: any) => {

        let optsToTry : SyncOpts[] = [
            {},
            { direction: 'both', existing: true, live: false },  // these are the defaults
        ];

        for (let opts of optsToTry) {
            let kw1 = scenario.constructor();
            let kw2 = scenario.constructor();

            // set up some keys
            t.ok(kw1.set({codec: CODEC, key: 'decoy2', value: 'zzz', author: author1, authorSecret: keypair1.secret, timestamp: now}), 'author1 set decoy key');  // winner  (push #1)
            t.ok(kw1.set({codec: CODEC, key: 'decoy1', value: 'aaa', author: author1, authorSecret: keypair1.secret, timestamp: now}), 'author1 set decoy key');  // winner  (push 2)
            t.ok(kw1.set({codec: CODEC, key: 'key1', value: 'one', author: author1, authorSecret: keypair1.secret, timestamp: now}), 'author1 set key1');      // becomes history  (push 3)
            t.ok(kw1.set({codec: CODEC, key: 'key1', value: 'two', author: author2, authorSecret: keypair2.secret, timestamp: now + 1}), 'author2 set key1');  // winner  (push 4)

            t.ok(kw2.set({codec: CODEC, key: 'latestOnKw1', value: '221', author: author1, authorSecret: keypair1.secret, timestamp: now}));       // dropped
            t.ok(kw1.set({codec: CODEC, key: 'latestOnKw1', value: '111', author: author1, authorSecret: keypair1.secret, timestamp: now + 10}));  // winner  (push 5)

            t.ok(kw1.set({codec: CODEC, key: 'latestOnKw2', value: '11', author: author1, authorSecret: keypair1.secret, timestamp: now}));       // dropped
            t.ok(kw2.set({codec: CODEC, key: 'latestOnKw2', value: '22', author: author1, authorSecret: keypair1.secret, timestamp: now + 10}));  // winner  (pull 1)

            t.ok(kw1.set({codec: CODEC, key: 'authorConflict', value: 'author1kw1', author: author1, authorSecret: keypair1.secret, timestamp: now}));      // becomes history  (push 6)
            t.ok(kw2.set({codec: CODEC, key: 'authorConflict', value: 'author2kw2', author: author2, authorSecret: keypair2.secret, timestamp: now + 1}));  // winner  (pull 2)

            // sync
            let syncResults = kw1.sync(kw2, opts);
            //log('sync results', syncResults);
            t.same(syncResults, { numPushed: 6, numPulled: 2 }, 'pushed 6 items, pulled 2 (including history)');

            t.equal(kw1.keys().length, 6, '6 keys');
            t.equal(kw1.items().length, 6, '6 items');
            t.equal(kw1.items({ includeHistory: true }).length, 8, '8 items with history');
            t.equal(kw1.values().length, 6, '6 values');
            t.equal(kw1.values({ includeHistory: true }).length, 8, '8 values with history');

            t.same(kw1.keys(), 'authorConflict decoy1 decoy2 key1 latestOnKw1 latestOnKw2'.split(' '), 'correct keys on kw1');
            t.same(kw1.values(), 'author2kw2 aaa zzz two 111 22'.split(' '), 'correct values on kw1');

            t.same(kw1.keys(), kw2.keys(), 'keys match');
            t.same(kw1.items(), kw2.items(), 'items match');
            t.same(kw1.items({ includeHistory: true }), kw2.items({ includeHistory: true }), 'items with history: match');
            t.same(kw1.values(), kw2.values(), 'values match');
            t.same(kw1.values({ includeHistory: true }), kw2.values({ includeHistory: true }), 'values with history: match');
        }

        t.done();
    });

    t.test(scenario.description + ': sync: misc other options', (t: any) => {
        let kwEmpty1 = scenario.constructor();
        let kwEmpty2 = scenario.constructor();
        let kw = scenario.constructor();

        // this time let's omit schema and timestamp
        t.ok(kw.set({codec: CODEC, key: 'foo', value: 'bar', author: author1, authorSecret: keypair1.secret}));

        // live mode (not implemented yet)
        t.throws(() => kwEmpty1.sync(kwEmpty2, {live: true}), 'live is not implemented yet and should throw');

        // sync with empty stores
        t.same(kwEmpty1.sync(kwEmpty2), { numPushed: 0, numPulled: 0 }, 'sync with empty stores');
        t.same(kwEmpty1.sync(kwEmpty2, {direction: 'push'}), { numPushed: 0, numPulled: 0 }, 'sync with empty stores');
        t.same(kwEmpty1.sync(kwEmpty2, {direction: 'pull'}), { numPushed: 0, numPulled: 0 }, 'sync with empty stores');
        t.same(kwEmpty1.sync(kwEmpty2, {direction: 'both'}), { numPushed: 0, numPulled: 0 }, 'sync with empty stores');
        t.same(kwEmpty1.sync(kwEmpty2, {existing: false}), { numPushed: 0, numPulled: 0 }, 'sync with empty stores');

        // sync with empty stores
        t.same(kw.sync(kwEmpty1, {direction: 'pull'}), { numPushed: 0, numPulled: 0 }, 'pull from empty store');
        t.same(kwEmpty1.sync(kw, {direction: 'push'}), { numPushed: 0, numPulled: 0 }, 'push to empty store');

        // sync with self
        t.same(kw.sync(kw), { numPushed: 0, numPulled: 0 }, 'sync with self should do nothing');

        // existing: false
        t.same(kw.sync(kwEmpty1, {existing: false}), { numPushed: 0, numPulled: 0 }, 'sync with existing: false does nothing');
        t.same(kwEmpty1.sync(kw, {existing: false}), { numPushed: 0, numPulled: 0 }, 'sync with existing: false does nothing');

        // successful sync
        t.same(kw.sync(kwEmpty1), { numPushed: 1, numPulled: 0 }, 'successful sync (push)');
        t.same(kwEmpty2.sync(kw), { numPushed: 0, numPulled: 1 }, 'successful sync (pull)');

        t.done();
    });
}
