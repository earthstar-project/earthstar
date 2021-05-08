import t = require('tap');
import { onFinishOneTest } from '../browser-run-exit';

import { WorkspaceAddress, } from '../../util/doc-types';
import { IStorageAsync, } from '../../storage/storage-types';
import { ICrypto } from '../../crypto/crypto-types';
import { Peer } from '../../peer/peer';
import { PeerClient } from '../../peer/peer-client';
import { PeerServer } from '../../peer/peer-server';

//================================================================================

import {
    Logger, LogLevel, setDefaultLogLevel, setLogLevel,
} from '../../util/log';

let loggerTest = new Logger('test', 'whiteBright');
let loggerTestCb = new Logger('test cb', 'white');
let J = JSON.stringify;

//setDefaultLogLevel(LogLevel.None);
//setLogLevel('peer client', LogLevel.Debug);
//setLogLevel('peer server', LogLevel.Debug);

//================================================================================

export let runPeerClientServerTests = (subtestName: string, crypto: ICrypto, makeStorage: (ws: WorkspaceAddress) => IStorageAsync) => {

    let TEST_NAME = 'peerClient + peerServer shared tests';
    let SUBTEST_NAME = subtestName;

    // Boilerplate to help browser-run know when this test is completed.
    // When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function.
    /* istanbul ignore next */ 
    (t.test as any)?.onFinish?.(() => onFinishOneTest(TEST_NAME, SUBTEST_NAME));

    t.test(SUBTEST_NAME + ': get workspaces in common', async (t: any) => {
        let clientWorkspaces = [
            '+common.one',
            '+common.two',
            '+common.three',
            '+onlyclient.club',
        ];
        let serverWorkspaces = [
            '+common.one',
            '+onlyserver.club',
            '+common.two',
            '+common.three',
        ]

        let clientPeer = new Peer();
        let serverPeer = new Peer();

        t.notSame(clientPeer.peerId, serverPeer.peerId, 'peerIds are not the same');

        // add storages
        for (let ws of clientWorkspaces) {
            let storage = makeStorage(ws);
            clientPeer.addStorage(storage);
        }
        for (let ws of serverWorkspaces) {
            let storage = makeStorage(ws);
            serverPeer.addStorage(storage);
        }

        // create Client and Server instances
        let client = new PeerClient(clientPeer, crypto);
        let server = new PeerServer(serverPeer, crypto);

        let wsInCommon = await client.discoverCommonWorkspaces(server);
        t.same(wsInCommon, [
            '+common.one',
            '+common.three',
            '+common.two',
        ], `discovered correct workspaces in common, and they're sorted`);

        // do it again just because doing so shouldn't break anything
        let wsInCommon2 = await client.discoverCommonWorkspaces(server);
        t.same(wsInCommon, wsInCommon2, 'same workspaces in common when run twice');

        t.end();
    });
};
