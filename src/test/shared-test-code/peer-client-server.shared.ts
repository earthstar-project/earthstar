import t = require('tap');
import { onFinishOneTest } from '../browser-run-exit';

import { WorkspaceAddress, } from '../../util/doc-types';
import { IStorageAsync, } from '../../storage/storage-types';
import { ICrypto } from '../../crypto/crypto-types';

import { NotImplementedError } from '../../util/errors';

import { Peer } from '../../peer/peer';
import { PeerClient } from '../../peer/peer-client';
import { PeerServer } from '../../peer/peer-server';

import {
    evaluator,
    makeProxy,
    ERROR_CLASSES,
} from '@earthstar-project/mini-rpc';

// tell mini-rpc which errors to treat specially
ERROR_CLASSES.concat([
    NotImplementedError,
]);

//================================================================================

import {
    Logger, LogLevel, setDefaultLogLevel, setLogLevel,
} from '../../util/log';

let loggerTest = new Logger('test', 'whiteBright');
let loggerTestCb = new Logger('test cb', 'white');
let J = JSON.stringify;

setDefaultLogLevel(LogLevel.None);
//setLogLevel('peer client', LogLevel.Debug);
//setLogLevel('peer client: do', LogLevel.Debug);
//setLogLevel('peer client: process', LogLevel.Debug);
//setLogLevel('peer client: update', LogLevel.Debug);
//setLogLevel('peer server', LogLevel.Debug);
//setLogLevel('peer server: serve', LogLevel.Debug);

//================================================================================

export let runPeerClientServerTests = (subtestName: string, crypto: ICrypto, makeStorage: (ws: WorkspaceAddress) => IStorageAsync) => {
    let TEST_NAME = 'peerClient + peerServer shared tests';
    let SUBTEST_NAME = subtestName;

    // Boilerplate to help browser-run know when this test is completed.
    // When run in the browser we'll be running tape, not tap, so we have to use tape's onFinish function.
    /* istanbul ignore next */ 
    (t.test as any)?.onFinish?.(() => onFinishOneTest(TEST_NAME, SUBTEST_NAME));

    let setupTest = () => {
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
        let expectedCommonWorkspaces = [
            // sorted
            '+common.one',
            '+common.three',
            '+common.two',
        ];

        // make Peers
        let peerOnClient = new Peer();
        let peerOnServer = new Peer();

        // make Storages and add them to the Peers
        for (let ws of clientWorkspaces) {
            peerOnClient.addStorage(makeStorage(ws));
        }
        for (let ws of serverWorkspaces) {
            peerOnServer.addStorage(makeStorage(ws));
        }

        return {
            peerOnClient,
            peerOnServer,
            expectedCommonWorkspaces,
        }
    }

    t.test(SUBTEST_NAME + ': getServerPeerId', async (t: any) => {
        let { peerOnClient, peerOnServer, expectedCommonWorkspaces } = setupTest();
        t.notSame(peerOnClient.peerId, peerOnServer.peerId, 'peerIds are not the same');
        let server = new PeerServer(crypto, peerOnServer);
        let client = new PeerClient(crypto, peerOnClient, server);

        // let them talk to each other
        t.ok(true, '------ getServerPeerId ------');
        let serverPeerId = await client.getServerPeerId();
        t.same(serverPeerId, peerOnServer.peerId, 'getServerPeerId works');
        t.same(client.state.serverPeerId, peerOnServer.peerId, 'setState worked');

        // close Storages
        for (let storage of peerOnClient.storages()) { await storage.close(); }
        for (let storage of peerOnServer.storages()) { await storage.close(); }
        t.end();
    });

    t.test(SUBTEST_NAME + ': saltyHandshake', async (t: any) => {
        let { peerOnClient, peerOnServer, expectedCommonWorkspaces } = setupTest();
        t.notSame(peerOnClient.peerId, peerOnServer.peerId, 'peerIds are not the same');
        let server = new PeerServer(crypto, peerOnServer);
        let client = new PeerClient(crypto, peerOnClient, server);

        // let them talk to each other
        t.ok(true, '------ saltyHandshake ------');
        await client.do_saltyHandshake();
        t.same(client.state.serverPeerId, server.peer.peerId, `client knows server's peer id`);
        t.notSame(client.state.lastSeenAt, null, 'client state lastSeeenAt is not null');
        t.same(client.state.commonWorkspaces, expectedCommonWorkspaces, 'client knows the correct common workspaces (and in sorted order)');

        // close Storages
        for (let storage of peerOnClient.storages()) { await storage.close(); }
        for (let storage of peerOnServer.storages()) { await storage.close(); }
        t.end();
    });

    t.test(SUBTEST_NAME + ': SaltyHandshake + AllStorageStates', async (t: any) => {
        let { peerOnClient, peerOnServer, expectedCommonWorkspaces } = setupTest();
        t.notSame(peerOnClient.peerId, peerOnServer.peerId, 'peerIds are not the same');
        let server = new PeerServer(crypto, peerOnServer);
        let client = new PeerClient(crypto, peerOnClient, server);

        // let them talk to each other
        t.ok(true, '------ saltyHandshake ------');
        await client.do_saltyHandshake();
        t.ok(true, '------ allStorageStates ------');
        await client.do_allStorageStates();

        t.same(
            Object.keys(client.state.clientStorageSyncStates).length,
            expectedCommonWorkspaces.length,
            'we now have info on the expected number of storages from the server'
        );
        let wsAddr0 = expectedCommonWorkspaces[0];
        let clientStorageSyncState0 = client.state.clientStorageSyncStates[wsAddr0];
        t.ok(true, 'for the first of the common workspaces...');
        t.same(clientStorageSyncState0.workspaceAddress, expectedCommonWorkspaces[0], 'workspace matches between key and value');
        t.same(clientStorageSyncState0.serverStorageId, server.peer.getStorage(wsAddr0)?.storageId, 'storageId matches server');
        t.same(clientStorageSyncState0.serverMaxLocalIndexSoFar, -1, 'server max local index so far starts at -1');
        t.same(clientStorageSyncState0.clientMaxLocalIndexSoFar, -1, 'client max local index so far starts at -1');

        // close Storages
        for (let storage of peerOnClient.storages()) { await storage.close(); }
        for (let storage of peerOnServer.storages()) { await storage.close(); }
        t.end();
    });

    t.test(SUBTEST_NAME + ': saltyHandshake with mini-rpc', async (t: any) => {
        let { peerOnClient, peerOnServer, expectedCommonWorkspaces } = setupTest();
        t.notSame(peerOnClient.peerId, peerOnServer.peerId, 'peerIds are not the same');

        // create Client and Server instances
        let server = new PeerServer(crypto, peerOnServer);
        let serverProxy = makeProxy(server, evaluator);

        // make a client that uses the proxy
        let client = new PeerClient(crypto, peerOnClient, serverProxy);

        // let them talk to each other
        t.ok(true, '------ saltyHandshake ------');
        let serverPeerId = await client.getServerPeerId();
        t.same(serverPeerId, peerOnServer.peerId, 'getServerPeerId works');
        t.same(client.state.serverPeerId, peerOnServer.peerId, 'setState worked');

        await client.do_saltyHandshake();

        t.same(client.state.serverPeerId, server.peer.peerId, `client knows server's peer id`);
        t.notSame(client.state.lastSeenAt, null, 'client state lastSeeenAt is not null');
        t.same(client.state.commonWorkspaces, expectedCommonWorkspaces, 'client knows the correct common workspaces (and in sorted order)');

        // close Storages
        for (let storage of peerOnClient.storages()) { await storage.close(); }
        for (let storage of peerOnServer.storages()) { await storage.close(); }
        t.end();
    });

};

