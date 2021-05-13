import { WorkspaceAddress } from '../util/doc-types';
import { ICrypto } from '../crypto/crypto-types';
import {
    IPeer,
    IPeerClient,
    IPeerServer,
    PeerId,
    SaltyHandshake_Outcome,
    SaltyHandshake_Request,
    SaltyHandshake_Response,
    saltAndHashWorkspace,
} from './peer-types';
import { sortedInPlace } from '../storage/compare';

//--------------------------------------------------

import { Logger } from '../util/log';
import { microsecondNow } from '../util/misc';
let logger = new Logger('peer client', 'greenBright');
let loggerDo = new Logger('peer client: do', 'green');
let loggerProcess = new Logger('peer client: process', 'cyan');
let loggerUpdate = new Logger('peer client: update', 'blue');
let J = JSON.stringify;

//================================================================================

// Data we learn from talking to the server.
// Null means not known yet.
// This should be easily serializable.
interface ClientState {
    serverPeerId: PeerId | null;
    commonWorkspaces: WorkspaceAddress[] | null;
    lastSeenAt: number | null,  // a timestamp in Earthstar-style microseconds
}

let defaultClientState: ClientState = {
    serverPeerId: null,
    commonWorkspaces: null,
    lastSeenAt: null,
}

export class PeerClient implements IPeerClient {
    crypto: ICrypto;
    peer: IPeer;
    server: IPeerServer;

    state: ClientState = { ...defaultClientState };

    // Each client only talks to one server.
    constructor(crypto: ICrypto, peer: IPeer, server: IPeerServer) {
        // TODO: load / save the client state (to where?)

        logger.debug('peerClient constructor');
        this.crypto = crypto;
        this.peer = peer;
        this.server = server;
        logger.debug(`...peerId: ${this.peer.peerId}`);
        logger.debug(`...client state:`);
        logger.debug(this.state);
    }

    async getServerPeerId(): Promise<PeerId> {
        let prevServerPeerId = this.state.serverPeerId;
        let serverPeerId = await this.server.getPeerId();
        this.state = {
            ...this.state,
            serverPeerId,
            lastSeenAt: microsecondNow(),
        }
        if (serverPeerId !== prevServerPeerId) {
            // if server has changed its id, reset some of our state
            this.state.commonWorkspaces = [];
        }
        return serverPeerId;
    }

    // do the entire thing
    async do_saltyHandshake(): Promise<void> {
        loggerDo.debug('do_saltyHandshake...');
        let request: SaltyHandshake_Request = {};
        loggerDo.debug('...asking server to serve_ ...');
        let response = await this.server.serve_saltyHandshake(request);
        loggerDo.debug('...client is going to process_ ...');
        let outcome = await this.process_saltyHandshake(response);
        loggerDo.debug('...client is going to update_ ...');
        await this.update_saltyHandshake(outcome);
        loggerDo.debug('...do_saltyHandshake is done');
    }

    // this does any computation or complex work needed to boil this down
    // into a simple state update, but it does not actually update our state,
    // it just returns the changes to the state
    async process_saltyHandshake(res: SaltyHandshake_Response): Promise<SaltyHandshake_Outcome> {
        loggerProcess.debug('process_saltyHandshake...');

        // figure out which workspaces we have in common
        // by salting and hashing our own workspaces in the same way
        // the server did, and seeing what matches
        let serverSaltedSet = new Set<string>(res.saltedWorkspaces);
        let commonWorkspaceSet = new Set<WorkspaceAddress>();
        for (let plainWs of this.peer.workspaces()) {
            let saltedWs = saltAndHashWorkspace(this.crypto, res.salt, plainWs);
            if (serverSaltedSet.has(saltedWs)) {
                commonWorkspaceSet.add(plainWs);
            }
        }
        let commonWorkspaces = sortedInPlace([...commonWorkspaceSet]);

        let outcome: SaltyHandshake_Outcome = {
            serverPeerId: res.serverPeerId,
            commonWorkspaces,
        };
        loggerProcess.debug('...process_saltyHandshake is done:');
        loggerProcess.debug(outcome);
        return outcome;
    }

    // this applies the changes to the state
    async update_saltyHandshake(outcome: SaltyHandshake_Outcome): Promise<void> {
        loggerUpdate.debug('update_saltyHandshake...');
        this.state = {
            ...this.state,
            serverPeerId: outcome.serverPeerId,
            commonWorkspaces: outcome.commonWorkspaces,
            lastSeenAt: microsecondNow(),
        }
        loggerUpdate.debug('...update_saltyHandshake is done.  client state is:');
        loggerUpdate.debug(this.state);
    }
}
