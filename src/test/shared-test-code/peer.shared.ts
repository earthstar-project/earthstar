import t = require('tap');
import { onFinishOneTest } from '../browser-run-exit';


import { WorkspaceAddress, } from '../../util/doc-types';
import { IStorageAsync, } from '../../storage/storage-types';
import { ICrypto } from '../../crypto/crypto-types';
import { compareByFn, sortedInPlace } from '../../storage/compare';
import { Peer } from '../../peer/peer';

//================================================================================

import {
    Logger,
} from '../../util/log';

let loggerTest = new Logger('test', 'whiteBright');
let loggerTestCb = new Logger('test cb', 'white');
let J = JSON.stringify;

//setDefaultLogLevel(LogLevel.None);
//setLogLevel('peer', LogLevel.Debug);

//================================================================================

export let runPeerTests = (subtestName: string, crypto: ICrypto, makeStorage: (ws: WorkspaceAddress) => IStorageAsync) => {

    let TEST_NAME = 'peer shared tests';
    let SUBTEST_NAME = subtestName;

    // Boilerplate to help browser-run know when this test is completed.
    // When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function.
    /* istanbul ignore next */ 
    (t.test as any)?.onFinish?.(() => onFinishOneTest(TEST_NAME, SUBTEST_NAME));

    t.test(SUBTEST_NAME + ': peer basics', async (t: any) => {
        let workspaces = [
            '+one.ws',
            '+two.ws',
            '+three.ws',
        ]
        let storages = workspaces.map(ws => makeStorage(ws));

        let sortedWorkspaces = sortedInPlace([...workspaces]);
        let sortedStorages = [...storages];
        sortedStorages.sort(compareByFn(storage => storage.workspace));

        let peer = new Peer();

        t.ok(typeof peer.peerId === 'string' && peer.peerId.length > 5, 'peer has a peerId');

        t.same(peer.hasWorkspace('+two.ws'), false, 'does not yet have +two.ws');
        t.same(peer.workspaces(), [], 'has no workspaces');
        t.same(peer.storages(), [], 'has no storages');
        t.same(peer.size(), 0, 'size is zero');

        for (let storage of storages) {
            await peer.addStorage(storage);
        }

        t.same(peer.hasWorkspace('nope'), false, 'does not have invalid workspace address');
        t.same(peer.hasWorkspace('+nope.ws'), false, 'does not have +nope.ws workspace');
        t.same(peer.hasWorkspace('+two.ws'), true, 'now it does have +two.ws');

        t.same(peer.workspaces(), sortedWorkspaces, 'has all 3 workspaces, sorted');
        t.same(peer.storages(), sortedStorages, 'has all 3 storages sorted by workspace');
        t.same(peer.size(), 3, 'size is 3');

        await peer.removeStorageByWorkspace('+one.ws');
        t.same(peer.workspaces(), ['+three.ws', '+two.ws'], 'removed by workspace address');
        t.same(peer.size(), 2, 'size is 2');

        await peer.removeStorage(storages[1]);  // that's two.ws
        t.same(peer.workspaces(), ['+three.ws'], 'removed storage instance');
        t.same(peer.size(), 1, 'size is 1');

        t.end();

        // TODO: eventually test peer.bus events when we have them
    });
};
