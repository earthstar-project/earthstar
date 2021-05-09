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

        // make Peers
        let peerOnClient = new Peer();
        let peerOnServer = new Peer();
        t.notSame(peerOnClient.peerId, peerOnServer.peerId, 'peerIds are not the same');

        // make Storages and add them to the Peers
        for (let ws of clientWorkspaces) {
            peerOnClient.addStorage(makeStorage(ws));
        }
        for (let ws of serverWorkspaces) {
            peerOnServer.addStorage(makeStorage(ws));
        }

        // create Client and Server instances
        let client = new PeerClient(peerOnClient, crypto);
        let server = new PeerServer(peerOnServer, crypto);

        // let Client talk to Server
        let commonWorkspacesAndServerPeerId = await client.discoverCommonWorkspacesAndServerPeerId(server);
        t.same(commonWorkspacesAndServerPeerId, {
            serverPeerId: peerOnServer.peerId,
            commonWorkspaces: [
                '+common.one',
                '+common.three',
                '+common.two',
            ],
        }, `discovered correct workspaces in common, and they're sorted`);

        // do it again just because doing so shouldn't break anything
        let commonWorkspacesAndServerPeerId2 = await client.discoverCommonWorkspacesAndServerPeerId(server);
        t.same(
            commonWorkspacesAndServerPeerId,
            commonWorkspacesAndServerPeerId2,
            'same workspaces in common when run twice'
        );

        // close Storages
        for (let storage of peerOnClient.storages()) { await storage.close(); }
        for (let storage of peerOnServer.storages()) { await storage.close(); }
        t.end();
    });
};
