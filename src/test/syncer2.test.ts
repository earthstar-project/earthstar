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
    OnePubOneWorkspaceSyncer,
    SyncerState,
} from '../sync/syncer2';
import { IStorage, IStorageAsync } from '../storage/storageTypes';
import { StorageToAsync } from '../storage/storageToAsync';

//================================================================================
// prepare for test scenarios

let WORKSPACE = '+gardenclub.xxxxxxxxxxxxxxxxxxxx';
let VALIDATORS : IValidator[] = [ValidatorEs4];
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
t.test('Syncer2: syncer should close when storage closes', async (t: any) => {
    let storage = makeStorage(WORKSPACE);
    let syncer = new OnePubOneWorkspaceSyncer(storage, 'http://example.com');

    let numCalls = 0;
    let lastCallbackVal : SyncerState | null = null;
    let unsub = syncer.onStateChange.subscribe(st => {
        //console.log('------- state change:', st);
        lastCallbackVal = st;
        numCalls += 1;
    });

    t.same(syncer.state, {
        // initial syncer state
        isPushStreaming: false,
        isPullStreaming: false,
        isBulkPulling: false,  // pullOnce()
        isBulkPushing: false,  // pushOnce()
        isBulkSyncing: false,  // the overall progress of syncOnce(), which is a wrapper around pullOnce() and pushOnce().
        closed: false,
        lastCompletedBulkPush: 0,  // timestamps in microseconds
        lastCompletedBulkPull: 0,
    }, 'initial syncer state as expected');

    // close storage.  this should close the syncer as well.
    await storage.close();
    t.equal(storage.isClosed(), true, 'storage was closed directly');

    t.equal(syncer.state.closed, true, 'syncer should be closed');
    t.equal(numCalls, 1, 'syncer.onStateChange callback should have been called once');

    t.end();
});