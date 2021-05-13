import t = require('tap');
import { onFinishOneTest } from '../browser-run-exit';

import { WorkspaceAddress, } from '../../util/doc-types';
import { IStorageAsync, } from '../../storage/storage-types';
import { ICrypto } from '../../crypto/crypto-types';

import { NotImplementedError, ValidationError } from '../../util/errors';

import { microsecondNow } from '../../util/misc';

import {
    IPeerServer,
    SaltyHandshake_Request,
    SaltyHandshake_Response,
} from "../../peer/peer-types";
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

//setDefaultLogLevel(LogLevel.None);
setLogLevel('peer client', LogLevel.Debug);
setLogLevel('peer client: do', LogLevel.Debug);
setLogLevel('peer client: process', LogLevel.Debug);
setLogLevel('peer client: update', LogLevel.Debug);
setLogLevel('peer server', LogLevel.Debug);
setLogLevel('peer server: serve', LogLevel.Debug);

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
        }
    }

    t.skip(SUBTEST_NAME + ': saltyHandshake, directly', async (t: any) => {
        let { peerOnClient, peerOnServer } = setupTest();
        t.notSame(peerOnClient.peerId, peerOnServer.peerId, 'peerIds are not the same');

        // create Client and Server instances
        let server = new PeerServer(crypto, peerOnServer);
        let client = new PeerClient(crypto, peerOnClient, server);

        // let them talk to each other
        await client.do_saltyHandshake();

        t.same(client.state.serverPeerId, server.peer.peerId, `client knows server's peer id`);
        t.notSame(client.state.lastSeenAt, null, 'client state lastSeeenAt is not null');
        t.same(client.state.commonWorkspaces, [
            '+common.one',
            '+common.three',
            '+common.two',
        ], 'client knows the correct common workspaces (and in sorted order)');

        // close Storages
        for (let storage of peerOnClient.storages()) { await storage.close(); }
        for (let storage of peerOnServer.storages()) { await storage.close(); }
        t.end();
    });

    t.test(SUBTEST_NAME + ': saltyHandshake with mini-rpc', async (t: any) => {
        let { peerOnClient, peerOnServer } = setupTest();
        t.notSame(peerOnClient.peerId, peerOnServer.peerId, 'peerIds are not the same');

        // create Client and Server instances
        let server = new PeerServer(crypto, peerOnServer);
        /*
        let serverMethods = {
            // you can either use the entire Server instance as your proxy object,
            // or you can list the server methods you want to expose here.
            serve_saltyHandshake: server.serve_saltyHandshake.bind(server),
            getPeerId: server.getPeerId.bind(server),

            // we can add more methods here too, for testing.
            throwGenericError: () => { throw new Error('a generic error') },
            throwNotImplemented: () => { throw new NotImplementedError('a not implemented error') },
            throwValidationError: () => { throw new ValidationError('a validation error') },
        };
        */
        let serverProxy = makeProxy(server, evaluator);

        // make a client that uses the proxy
        let client = new PeerClient(crypto, peerOnClient, serverProxy);

        // let them talk to each other
        let serverPeerId = await client.getServerPeerId();
        t.same(serverPeerId, peerOnServer.peerId, 'getServerPeerId works');

        await client.do_saltyHandshake();

        t.same(client.state.serverPeerId, server.peer.peerId, `client knows server's peer id`);
        t.notSame(client.state.lastSeenAt, null, 'client state lastSeeenAt is not null');
        t.same(client.state.commonWorkspaces, [
            '+common.one',
            '+common.three',
            '+common.two',
        ], 'client knows the correct common workspaces (and in sorted order)');

        /*
        try {
            await serverProxy.throwGenericError();
            t.ok(false, 'should have thrown generic error');
        } catch (err) {
            t.ok(true, `got expected error: ${err} / ${err.name} / ${err.message}`);
            t.ok(err instanceof Error, 'is instance of Error');
        }
        try {
            await serverProxy.throwNotImplemented();
            t.ok(false, 'should have thrown not implemented error');
        } catch (err) {
            t.ok(true, `got expected error: ${err} / ${err.name} / ${err.message}`);
            t.ok(err instanceof NotImplementedError, 'is instance of NotImplementedError');
        }
        try {
            await serverProxy.throwValidationError();
            t.ok(false, 'should have thrown validation error');
        } catch (err) {
            t.ok(true, `got expected error: ${err} / ${err.name} / ${err.message}`);
            t.ok(err instanceof ValidationError, 'is instance of ValidationError');
        }
        */

        // close Storages
        for (let storage of peerOnClient.storages()) { await storage.close(); }
        for (let storage of peerOnServer.storages()) { await storage.close(); }
        t.end();
    });

};

