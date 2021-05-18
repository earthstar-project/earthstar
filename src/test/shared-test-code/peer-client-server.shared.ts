import t = require('tap');
import { onFinishOneTest } from '../browser-run-exit';

import { WorkspaceAddress, } from '../../util/doc-types';
import { IStorageAsync, } from '../../storage/storage-types';
import { ICrypto } from '../../crypto/crypto-types';

import { isErr, NotImplementedError } from '../../util/errors';

import { WorkspaceQuery_Request } from '../../peer/peer-types';
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
//setLogLevel('test', LogLevel.Debug);
//setLogLevel('test cb', LogLevel.Debug);
//setLogLevel('peer client', LogLevel.Debug);
//setLogLevel('peer client: do', LogLevel.Debug);
//setLogLevel('peer client: handle', LogLevel.Debug);
//setLogLevel('peer client: process', LogLevel.Debug);
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

        // make some identities
        let author1 = crypto.generateAuthorKeypair('onee');
        let author2 = crypto.generateAuthorKeypair('twoo');
        let author3 = crypto.generateAuthorKeypair('thre');

        if (isErr(author1)) { throw author1; }
        if (isErr(author2)) { throw author2; }
        if (isErr(author3)) { throw author3; }

        return {
            peerOnClient,
            peerOnServer,
            expectedCommonWorkspaces,
            author1,
            author2,
            author3,
        }
    }

    t.test(SUBTEST_NAME + ': getServerPeerId', async (t: any) => {
        let { peerOnClient, peerOnServer } = setupTest();
        t.notSame(peerOnClient.peerId, peerOnServer.peerId, 'peerIds are not the same, as expected');
        let server = new PeerServer(crypto, peerOnServer);
        let client = new PeerClient(crypto, peerOnClient, server);

        // let them talk to each other
        t.ok(true, '------ getServerPeerId ------');
        loggerTest.debug(true, '------ getServerPeerId ------');
        let serverPeerId = await client.do_getServerPeerId();
        loggerTest.debug(true, '------ /getServerPeerId ------');

        t.same(serverPeerId, peerOnServer.peerId, 'getServerPeerId works');
        t.same(client.state.serverPeerId, peerOnServer.peerId, 'setState worked');

        // close Storages
        for (let storage of peerOnClient.storages()) { await storage.close(); }
        for (let storage of peerOnServer.storages()) { await storage.close(); }
        t.end();
    });

    t.test(SUBTEST_NAME + ': SaltyHandshake + AllWorkspaceState + WorkspaceQuery', async (t: any) => {
        let {
            peerOnClient,
            peerOnServer,
            expectedCommonWorkspaces,
            author1,
            author2,
            author3,
        } = setupTest();
        let server = new PeerServer(crypto, peerOnServer);
        let client = new PeerClient(crypto, peerOnClient, server);
        let workspace0 = expectedCommonWorkspaces[0];
        let storage0peer = server.peer.getStorage(workspace0) as IStorageAsync;
        await storage0peer.set(author1, {
            format: 'es.4',
            path: '/author1',
            content: 'a1',
        });
        // this doc will be overwritten
        // the total number of docs will be 2
        await storage0peer.set(author2, {
            format: 'es.4',
            path: '/author2',
            content: 'a2',
        });
        await storage0peer.set(author2, {
            format: 'es.4',
            path: '/author2',
            content: 'a2.1',
        });

        // let them talk to each other
        t.ok(true, '------ saltyHandshake ------');
        loggerTest.debug(true, '------ saltyHandshake ------');
        await client.do_saltyHandshake();
        loggerTest.debug(true, '------ /saltyHandshake ------');

        t.same(client.state.serverPeerId, server.peer.peerId, `client knows server's peer id`);
        t.notSame(client.state.lastSeenAt, null, 'client state lastSeeenAt is not null');
        t.same(client.state.commonWorkspaces, expectedCommonWorkspaces, 'client knows the correct common workspaces (and in sorted order)');

        t.ok(true, '------ allWorkspaceStates ------');
        loggerTest.debug(true, '------ allWorkspaceStates ------');
        await client.do_allWorkspaceStates();
        loggerTest.debug(true, '------ /allWorkspaceStates ------');

        t.same(
            Object.keys(client.state.workspaceStates).length,
            expectedCommonWorkspaces.length,
            'we now have info on the expected number of storages from the server'
        );
        let workspaceState0 = client.state.workspaceStates[workspace0];
        t.ok(true, 'for the first of the common workspaces...');
        t.same(workspaceState0.workspace, expectedCommonWorkspaces[0], 'workspace matches between key and value');
        t.same(workspaceState0.serverStorageId, server.peer.getStorage(workspace0)?.storageId, 'storageId matches server');
        t.same(workspaceState0.serverMaxLocalIndexSoFar, -1, 'server max local index so far starts at -1');
        t.same(workspaceState0.clientMaxLocalIndexSoFar, -1, 'client max local index so far starts at -1');

        t.ok(true, '------ workspaceQuery ------');
        loggerTest.debug(true, '------ workspaceQuery ------');
        let workspace: WorkspaceAddress = expectedCommonWorkspaces[0];
        let workspaceState = client.state.workspaceStates[workspace];
        let storageId = workspaceState.serverStorageId;
        let startAfter = workspaceState.serverMaxLocalIndexSoFar;
        let queryRequest: WorkspaceQuery_Request = {
            workspace,
            storageId,
            query: {
                historyMode: 'all',
                orderBy: 'localIndex ASC',
                startAfter: { localIndex: startAfter },
                // filter
                // limit
            }
        }
        let numPulled = await client.do_workspaceQuery(queryRequest);
        loggerTest.debug(true, '------ /workspaceQuery ------');

        t.same(numPulled, 2, 'pulled all 2 docs');
        workspaceState0 = client.state.workspaceStates[workspace0];
        t.ok(true, 'for the first of the common workspaces...');
        t.same(workspaceState0.workspace, workspace0);
        t.same(workspaceState0.serverMaxLocalIndexOverall, 2);
        t.same(workspaceState0.serverMaxLocalIndexSoFar, 2);

        t.ok(true, '------ workspaceQuery again ------');
        loggerTest.debug(true, '------ workspaceQuery again ------');
        // continue where we left off
        workspaceState = client.state.workspaceStates[workspace];
        startAfter = workspaceState.serverMaxLocalIndexSoFar;
        queryRequest = {
            workspace,
            storageId,
            query: {
                historyMode: 'all',
                orderBy: 'localIndex ASC',
                startAfter: { localIndex: startAfter },
                // filter
                // limit
            }
        }
        numPulled = await client.do_workspaceQuery(queryRequest);
        loggerTest.debug(true, '------ /workspaceQuery again ------');

        t.same(numPulled, 0, 'pulled 0 docs this time');
        t.ok(true, 'no changes to workspaceState for this workspace');
        t.same(workspaceState0.workspace, workspace0);
        t.same(workspaceState0.serverMaxLocalIndexOverall, 2);
        t.same(workspaceState0.serverMaxLocalIndexSoFar, 2);

        // close Storages
        for (let storage of peerOnClient.storages()) { await storage.close(); }
        for (let storage of peerOnServer.storages()) { await storage.close(); }
        t.end();
    });

    t.test(SUBTEST_NAME + ': saltyHandshake with mini-rpc', async (t: any) => {
        let { peerOnClient, peerOnServer, expectedCommonWorkspaces } = setupTest();

        // create Client and Server instances
        let serverLocal = new PeerServer(crypto, peerOnServer);
        let serverProxy = makeProxy(serverLocal, evaluator);

        // make a client that uses the proxy
        let client = new PeerClient(crypto, peerOnClient, serverProxy);

        // let them talk to each other
        t.ok(true, '------ saltyHandshake ------');
        let serverPeerId = await client.do_getServerPeerId();
        t.same(serverPeerId, peerOnServer.peerId, 'getServerPeerId works');
        t.same(client.state.serverPeerId, peerOnServer.peerId, 'setState worked');

        await client.do_saltyHandshake();

        t.same(client.state.serverPeerId, serverLocal.peer.peerId, `client knows server's peer id`);
        t.notSame(client.state.lastSeenAt, null, 'client state lastSeeenAt is not null');
        t.same(client.state.commonWorkspaces, expectedCommonWorkspaces, 'client knows the correct common workspaces (and in sorted order)');

        // close Storages
        for (let storage of peerOnClient.storages()) { await storage.close(); }
        for (let storage of peerOnServer.storages()) { await storage.close(); }
        t.end();
    });

};

