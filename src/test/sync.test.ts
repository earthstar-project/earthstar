import t = require('tap');
import {
    AuthorAddress,
    FormatName,
    IStorage,
    IValidator,
} from '../util/types';
import {
    generateAuthorKeypair
} from '../crypto/crypto';
import {
    StorageMemory,
} from '../storage/memory';
import {
    ValidatorEs2,
} from '../validator/es2';
import {
    SyncState,
    Syncer,
} from '../sync';

//================================================================================
// prepare for test scenarios

let WORKSPACE = '+gardenclub.xxxxxxxxxxxxxxxxxxxx';
let FORMAT : FormatName = 'es.2';
let VALIDATORS : IValidator[] = [ValidatorEs2];

let keypair1 = generateAuthorKeypair('test');
let keypair2 = generateAuthorKeypair('twoo');
let keypair3 = generateAuthorKeypair('thre');
let author1: AuthorAddress = keypair1.address;
let author2: AuthorAddress = keypair2.address;
let author3: AuthorAddress = keypair3.address;
let now = 1500000000000000;

let makeStorage = (workspace : string) : IStorage =>
    new StorageMemory(VALIDATORS, workspace);

//================================================================================
t.test('Syncer basics and callback subscriptions', (t: any) => {
    let storage = makeStorage(WORKSPACE);
    let syncer = new Syncer(storage);

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

    t.end();
});

t.test('Syncer sync when empty', async (t: any) => {
    let storage = makeStorage(WORKSPACE);
    let syncer = new Syncer(storage);

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

    t.end();
});
