import t = require('tap');
import {
    AuthorAddress,
    AuthorKeypair,
    FormatName,
    IValidator,
    isErr,
} from '../util/types';
import {
    generateAuthorKeypair
} from '../crypto/crypto';
import {
    StorageMemory,
} from '../storage/storageMemory';
import {
    ValidatorEs4,
} from '../validator/es4';
import {
    SyncState,
    Syncer1,
} from '../sync/syncer1';
import { IStorage, IStorageAsync } from '../storage/storageTypes';
import { StorageToAsync } from '../storage/storageToAsync';

//================================================================================
// prepare for test scenarios

let WORKSPACE = '+gardenclub.xxxxxxxxxxxxxxxxxxxx';
let VALIDATORS: [IValidator, ...IValidator[]] = [ValidatorEs4];
let FORMAT : FormatName = VALIDATORS[0].format;

let keypair1 = generateAuthorKeypair('test') as AuthorKeypair;
let keypair2 = generateAuthorKeypair('twoo') as AuthorKeypair;
let keypair3 = generateAuthorKeypair('thre') as AuthorKeypair;
if (isErr(keypair1)) { throw "oops"; }
if (isErr(keypair2)) { throw "oops"; }
if (isErr(keypair3)) { throw "oops"; }
let author1: AuthorAddress = keypair1.address;
let author2: AuthorAddress = keypair2.address;
let author3: AuthorAddress = keypair3.address;
let now = 1500000000000000;

let makeStorage = (workspace : string) : IStorageAsync =>
    new StorageToAsync(new StorageMemory(VALIDATORS, workspace), 0);

//================================================================================
t.test('Syncer basics and callback subscriptions', (t: any) => {
    let storage = makeStorage(WORKSPACE);
    let syncer = new Syncer1(storage);
    
    let numCalls = 0;
    let lastCallbackVal : SyncState | null = null;
    let unsub = syncer.onChange.subscribe(st => {
        lastCallbackVal = st;
        numCalls += 1;
    });

    t.equal(syncer.state.pubs.length, 0, 'start with 0 pubs');

    syncer.addPub('https://example.com/');
    syncer.addPub('https://example.com');
    t.equal(syncer.state.pubs.length, 1, 'add same pub twice, end up with 1');

    t.equal(numCalls, 1, 'callback should have been called once');
    t.same(lastCallbackVal, {
        pubs: [{
            domain: 'https://example.com/',  // with trailing slash
            syncState: 'idle',
            lastSync: 0,
        }],
        syncState: 'idle',
        lastSync: 0,
    }, 'expected callback value');

    syncer.removePub('https://example.com/');
    syncer.removePub('https://example.com');
    t.equal(syncer.state.pubs.length, 0, 'remove same pub twice, end up with 0');
    t.equal(numCalls, 2, 'callback should have been called 1 more time');
    t.same(lastCallbackVal, {
        pubs: [],
        syncState: 'idle',
        lastSync: 0,
    }, 'expected callback value');

    unsub();
    syncer.addPub('https://example.com');
    t.equal(numCalls, 2, 'callback should not have been called after unsubscribing');

    storage.close();
    t.end();
});

t.test('Syncer sync when empty', async (t: any) => {
    let storage = makeStorage(WORKSPACE);
    let syncer = new Syncer1(storage);

    let numCalls = 0;
    let lastCallbackVal : SyncState | null = null;
    let unsub = syncer.onChange.subscribe(st => {
        console.log('notification');
        lastCallbackVal = st;
        numCalls += 1;
    });

    await syncer.sync();
    t.equal(numCalls, 2, 'callback was called twice');
    t.equal((lastCallbackVal as any as SyncState)?.syncState, 'idle', 'sync with no pubs ends up idle');

    unsub();

    storage.close();
    t.end();
});
