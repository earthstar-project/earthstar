import fs = require('fs');
import t = require('tap');
//t.runOnly = true;

import {
    AuthorKeypair,
    IValidator,
    isErr,
} from '../util/types';
import {
    generateAuthorKeypair,
} from '../crypto/crypto';
import { ValidatorEs4 } from '../validator/es4';

import {
    IStorage,
    IStorageAsync,
} from '../storage/storageTypes';
import { StorageSqlite } from '../storage/storageSqlite';
import { StorageToAsync } from '../storage/storageToAsync';

import {
    Scenario,
    runStorageTestsForScenario,
} from './storageAsyncTests.setup'

//================================================================================
// prepare for test scenarios

let WORKSPACE = '+gardenclub.xxxxxxxxxxxxxxxxxxxx';

let VALIDATORS : IValidator[] = [ValidatorEs4];

// tests assume these are in alphabetical order by author shortname
let keypair1 = generateAuthorKeypair('aut1') as AuthorKeypair;
let keypair2 = generateAuthorKeypair('aut2') as AuthorKeypair;
let keypair3 = generateAuthorKeypair('aut3') as AuthorKeypair;
let keypair4 = generateAuthorKeypair('aut4') as AuthorKeypair;
if (isErr(keypair1)) { throw "oops"; }
if (isErr(keypair2)) { throw "oops"; }
if (isErr(keypair3)) { throw "oops"; }
if (isErr(keypair4)) { throw "oops"; }
let now = 1500000000000000;

let SEC = 1000000;
let MIN = SEC * 60;
let HOUR = MIN * 60;
let DAY = HOUR * 24;

//================================================================================
// sqlite specific constructor tests

t.test(`StoreSqlite: opts: workspace and filename requirements`, (t: any) => {
    let fn: string;
    let clearFn = (fn: string) => {
        if (fs.existsSync(fn)) { fs.unlinkSync(fn); }
    }
    let touchFn = (fn: string) => { fs.writeFileSync(fn, 'foo'); }

    // create with :memory:
    t.doesNotThrow(() => {
        let storage = new StorageSqlite({
            mode: 'create',
            workspace: WORKSPACE,
            validators: VALIDATORS,
            filename: ':memory:'
        });
        storage.close();
    }, 'create mode works when workspace is provided, :memory:');
    t.throws(() => {
        let storage = new StorageSqlite({
            mode: 'create',
            workspace: null as any,
            validators: VALIDATORS,
            filename: ':memory:'
        });
        storage.close();
    }, 'create mode throws when workspace is null, :memory:');
    t.throws(() => {
        let storage = new StorageSqlite({
            mode: 'create',
            workspace: 'bad-workspace-address',
            validators: VALIDATORS,
            filename: ':memory:'
        });
        storage.close();
    }, 'create mode throws when workspace address is invalid, :memory:');
    t.throws(() => {
        let storage = new StorageSqlite({
            mode: 'create',
            workspace: 'bad-workspace-address',
            validators: [],
            filename: ':memory:'
        });
        storage.close();
    }, 'create mode fails when no validators are provided');

    // create with real filename
    fn = 'testtesttest1a.db';
    clearFn(fn);
    t.doesNotThrow(
        () => {
            let storage = new StorageSqlite({
                mode: 'create',
                workspace: WORKSPACE,
                validators: VALIDATORS,
                filename: fn,
            })
            t.ok(fs.existsSync(fn), 'create mode created a file');
            storage.close();
            storage.close();
            storage.close({ delete: true });
            t.ok(fs.existsSync(fn), 'close with forget does not delete file if storage was already closed');
        },
        'create mode works when workspace is provided and a real filename'
    );
    clearFn(fn);

    fn = 'testtesttest1aa.db';
    clearFn(fn);
    t.doesNotThrow(
        () => {
            let storage = new StorageSqlite({
                mode: 'create',
                workspace: WORKSPACE,
                validators: VALIDATORS,
                filename: fn,
            })
            t.ok(fs.existsSync(fn), 'create mode created a file');
            storage.close({ delete: true });
            storage.close({ delete: true });
            storage.close();
            t.ok(!fs.existsSync(fn), 'close with forget does delete if called first');
        },
        'create mode works when workspace is provided and a real filename'
    );
    clearFn(fn);

    // create with existing filename
    fn = 'testtesttest1b.db';
    touchFn(fn);
    t.throws(() => {
        let storage = new StorageSqlite({
            mode: 'create',
            workspace: WORKSPACE,
            validators: VALIDATORS,
            filename: fn,
        });
        storage.close();
    }, 'create mode throws when pointed at existing file');
    clearFn(fn);

    // open and :memory:
    t.throws(() => {
        let storage = new StorageSqlite({
            mode: 'open',
            workspace: WORKSPACE,
            validators: VALIDATORS,
            filename: ':memory:',
        });
        storage.close();
    }, 'open mode throws with :memory: and a workspace');
    t.throws(() => {
        let storage = new StorageSqlite({
            mode: 'open',
            workspace: null,
            validators: VALIDATORS,
            filename: ':memory:',
        });
        storage.close();
    }, 'open mode throws with :memory: and null workspace');

    // open missing filename
    t.throws(() => {
        let storage = new StorageSqlite({
            mode: 'open',
            workspace: WORKSPACE,
            validators: VALIDATORS,
            filename: 'xxx',
        });
        storage.close();
    }, 'open mode throws when file does not exist');

    // create-or-open :memory:
    t.doesNotThrow(() => {
        let storage = new StorageSqlite({
            mode: 'create-or-open',
            workspace: WORKSPACE,
            validators: VALIDATORS,
            filename: ':memory:'
        });
        storage.close();
    }, 'create-or-open mode works when workspace is provided');
    t.throws(() => {
        let storage = new StorageSqlite({
            mode: 'create-or-open',
            workspace: null as any,
            validators: VALIDATORS,
            filename: ':memory:'
        });
        storage.close();
    }, 'create-or-open mode throws when workspace is null');

    // create-or-open: create then open real file
    fn = 'testtesttest3.db';
    clearFn(fn);
    t.doesNotThrow(() => {
        let storage = new StorageSqlite({
            mode: 'create-or-open',
            workspace: WORKSPACE,
            validators: VALIDATORS,
            filename: fn,
        });
        storage.close();
    }, 'create-or-open mode works when creating a real file');
    t.ok(fs.existsSync(fn), 'create-or-open mode created a file');
    t.throws(() => {
        let storage = new StorageSqlite({
            mode: 'create-or-open',
            workspace: 'xxx',
            validators: VALIDATORS,
            filename: fn,
        });
        storage.close();
    }, 'create-or-open mode fails when opening existing file with mismatched workspace');
    t.doesNotThrow(() => {
        let storage = new StorageSqlite({
            mode: 'create-or-open',
            workspace: WORKSPACE,
            validators: VALIDATORS,
            filename: fn,
        });
        storage.close();
    }, 'create-or-open mode works when opening a real file with matching workspace');
    clearFn(fn);

    // open: create then open real file
    fn = 'testtesttest4.db';
    clearFn(fn);
    t.doesNotThrow(() => {
        let storage = new StorageSqlite({
            mode: 'create',
            workspace: WORKSPACE,
            validators: VALIDATORS,
            filename: fn,
        });
        storage.close();
    }, 'creating a real file');
    t.ok(fs.existsSync(fn), 'file was created');
    t.throws(() => {
        let storage = new StorageSqlite({
            mode: 'open',
            workspace: 'xxx',
            validators: VALIDATORS,
            filename: fn,
        });
        storage.close();
    }, 'open throws when workspace does not match');
    t.doesNotThrow(() => {
        let storage = new StorageSqlite({
            mode: 'open',
            workspace: WORKSPACE,
            validators: VALIDATORS,
            filename: fn,
        });
        storage.close();
    }, 'open works when workspace matches');
    t.ok(fs.existsSync(fn), 'file still exists');
    t.doesNotThrow(() => {
        let storage = new StorageSqlite({
            mode: 'open',
            workspace: null,
            validators: VALIDATORS,
            filename: fn,
        });
        storage.close({ delete: true });
    }, 'open works when workspace is null');
    t.ok(!fs.existsSync(fn), 'file was removed');
    clearFn(fn);

    // unrecognized mode
    t.throws(() => {
        let storage = new StorageSqlite({
            mode: 'xxx' as any,
            workspace: null,
            validators: VALIDATORS,
            filename: ':memory:'
        });
        storage.close();
    }, 'constructor throws with unrecognized mode');

    t.end();
});

//================================================================================
// MAIN TESTS

let scenarios : Scenario[] = [
    {
        makeStorage: (workspace : string) : IStorage => {
            let storage = new StorageSqlite({
                mode: 'create',
                workspace: workspace,
                validators: VALIDATORS,
                filename: ':memory:',
            });
            storage._now = now;
            return storage;
        },
        description: "StorageSqlite",
    },
    {
        makeStorage: (workspace : string) : IStorageAsync => {
            let storage = new StorageSqlite({
                mode: 'create',
                workspace: workspace,
                validators: VALIDATORS,
                filename: ':memory:',
            });
            let asyncStorage = new StorageToAsync(storage, 10);
            asyncStorage._now = now;
            return asyncStorage;
        },
        description: "Async'd StorageSqlite",
    },
];

for (let scenario of scenarios) {
    runStorageTestsForScenario(scenario);
}
