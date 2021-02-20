import * as fs from 'fs';
import t = require('tap');
//t.runOnly = true;

import {
    AuthorKeypair,
    FormatName,
    IValidator,
    WriteResult,
    isErr,
} from '../util/types';
import {
    IStorage,
} from '../storage/storageTypes';
import {
    generateAuthorKeypair,
} from '../crypto/crypto';
import { ValidatorEs4 } from '../validator/es4';
import { StorageMemory } from '../storage/storageMemory';

import { deleteMyDocuments } from '../extras';

//================================================================================
// prepare for test scenarios

let WORKSPACE = '+gardenclub.xxxxxxxxxxxxxxxxxxxx';

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
    //{
    //    makeStorage: (workspace : string) : IStorage => new StorageSqlite({
    //        mode: 'create',
    //        workspace: workspace,
    //        validators: VALIDATORS,
    //        filename: ':memory:'
    //    }),
    //    description: "StoreSqlite(':memory:')",
    //},
];

//================================================================================
// run the standard store tests on each scenario

for (let scenario of scenarios) {
    t.test(`==== starting test of ====${scenario.description}`, (t: any) => {
        t.end();
    });

    t.test(scenario.description + ': deleteMyDocuments', (t: any) => {
        let now = Date.now() * 1000;
        let storage = scenario.makeStorage(WORKSPACE);

        // scenarios:

        // an old doc you wrote which someone else has superceded
        t.same(storage.set(keypair1, {format: FORMAT, path: '/path1', content: 'val1 keypair1', timestamp: now - 60 }), WriteResult.Accepted, 'make doc 1...');
        t.equal(storage.getContent('/path1'), 'val1 keypair1');

        t.same(storage.set(keypair2, {format: FORMAT, path: '/path1', content: 'val1 keypair2', timestamp: now - 30 }), WriteResult.Accepted, 'overwrite doc 1 by second author...');
        t.equal(storage.getContent('/path1'), 'val1 keypair2');

        // a lone document
        t.same(storage.set(keypair1, {format: FORMAT, path: '/path2', content: 'val2 keypair1', timestamp: now - 10 }), WriteResult.Accepted, 'make doc 2');
        t.equal(storage.getContent('/path2'), 'val2 keypair1');

        // an ephemeral document
        t.same(storage.set(keypair1, {format: FORMAT, path: '/path3!', content: 'val3 keypair1', timestamp: now - 10, deleteAfter: now + DAY }), WriteResult.Accepted, 'make ephemeral doc 3');
        t.equal(storage.getContent('/path3!'), 'val3 keypair1');

        // you superceded someone else's old document
        t.same(storage.set(keypair2, {format: FORMAT, path: '/path4', content: 'val4 keypair2', timestamp: now - 60 }), WriteResult.Accepted, 'make doc 4 by second author...');
        t.equal(storage.getContent('/path4'), 'val4 keypair2');

        t.same(storage.set(keypair1, {format: FORMAT, path: '/path4', content: 'val4 keypair1', timestamp: now - 30 }), WriteResult.Accepted, 'overwrite doc 4 by main author...');
        t.equal(storage.getContent('/path4'), 'val4 keypair1');

        // check that writes worked as expected
        t.same(storage.paths(), ['/path1', '/path2', '/path3!', '/path4'], 'paths() are correct');
        t.same(storage.paths({ contentLengthGt: 0 }), ['/path1', '/path2', '/path3!', '/path4'], 'four paths have non-empty content');
        t.same(storage.authors(), [keypair1.address, keypair2.address], 'authors() are correct');
        t.same(storage.documents({ history: 'all', contentLengthGt: 0 }).length, 6, '6 doc versions exist and all are full of content');

        // do the deletion
        let { numDeleted, numErrors } = deleteMyDocuments(storage, keypair1);

        // check that deletion succeeded
        t.same(numDeleted, 4, '4 were deleted');
        t.same(numErrors, 0, '0 errors');

        t.same(storage.getContent('/path1'), 'val1 keypair2', 'your old doc deletion has not affected the superceding doc at path1');
        t.same(storage.getContent('/path4'), '', 'your newer doc deletion has left behind an empty string which wins over author2\'s older doc');

        t.same(storage.paths(), ['/path1', '/path2', '/path3!', '/path4'], 'after deleteMyDocuments, paths() are unchanged because the empty docs still exist');
        t.same(storage.paths({ contentLengthGt: 0 }), ['/path1'], 'only one path has non-empty content.  (one is shadowed by your now-empty newer doc)');
        t.same(storage.authors(), [keypair1.address, keypair2.address], 'authors() are unchanged');
        t.same(storage.documents({ history: 'all', contentLengthGt: 0 }).length, 2, '2 doc versions has content');
        t.same(storage.documents({ history: 'all', contentLength: 0}).length, 4, '4 doc versions are empty');

        for (let doc of storage.documents({ history: 'all', author: keypair1.address })) {
            t.same(doc.content, '', `doc ${doc.path} by keypair1 has empty content`);
        }

        storage.close();
        t.end();
    });

}
