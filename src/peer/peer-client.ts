import { WorkspaceAddress } from '../util/doc-types';
import { ICrypto } from '../crypto/crypto-types';
import {
    IPeer,
    IPeerClient,
    IPeerServer,
    PeerClientState,
    PeerId,
    SaltyHandshake_Outcome,
    SaltyHandshake_Request,
    SaltyHandshake_Response,
    initialPeerClientState,
    saltAndHashWorkspace,
    AllStorageStates_Outcome,
    AllStorageStates_Response,
    AllStorageStates_Request,
    ServerStorageSyncState,
    ClientStorageSyncState,
} from './peer-types';
import { sortedInPlace } from '../storage/compare';

//--------------------------------------------------

import { Logger } from '../util/log';
import { microsecondNow } from '../util/misc';
import { NotImplementedError, ValidationError } from '../util/errors';
import { RSA_NO_PADDING } from 'constants';
let logger = new Logger('peer client', 'greenBright');
let loggerDo = new Logger('peer client: do', 'green');
let loggerProcess = new Logger('peer client: process', 'cyan');
let loggerUpdate = new Logger('peer client: update', 'blue');
let J = JSON.stringify;

//================================================================================

export class PeerClient implements IPeerClient {
    crypto: ICrypto;
    peer: IPeer;
    server: IPeerServer;

    state: PeerClientState = { ...initialPeerClientState };

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

    async setState(newState: Partial<PeerClientState>): Promise<void> {
        this.state = { ...this.state, ...newState };
    }

    async getServerPeerId(): Promise<PeerId> {
        let prevServerPeerId = this.state.serverPeerId;
        let serverPeerId = await this.server.getPeerId();
        if (serverPeerId === prevServerPeerId) {
            await this.setState({
                serverPeerId,
                lastSeenAt: microsecondNow(),
            });
        } else {
            // if server has changed its id,
            // we need to reset the commonWorkspaces
            await this.setState({
                serverPeerId,
                commonWorkspaces: [],
                lastSeenAt: microsecondNow(),
            });
        }
        return serverPeerId;
    }

    //--------------------------------------------------
    // SALTY HANDSHAKE

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

    async update_saltyHandshake(outcome: SaltyHandshake_Outcome): Promise<void> {
        loggerUpdate.debug('update_saltyHandshake...');
        await this.setState({
            serverPeerId: outcome.serverPeerId,
            commonWorkspaces: outcome.commonWorkspaces,
            lastSeenAt: microsecondNow(),
        });
        loggerUpdate.debug('...update_saltyHandshake is done.  client state is:');
        loggerUpdate.debug(this.state);
    }

    //--------------------------------------------------
    // ALL STORAGE STATES

    async do_allStorageStates(): Promise<void> {
        loggerDo.debug('do_allStorageStates...');
        loggerDo.debug('...initial client state:');
        loggerDo.debug(this.state);

        // nothing to ask about?
        if (this.state.commonWorkspaces === null || this.state.commonWorkspaces.length === 0) {
            loggerDo.debug('...actually there are no common workspaces to ask about, so quitting early');
            return;
        }

        let request: AllStorageStates_Request = {
            commonWorkspaces: this.state.commonWorkspaces || [],
        };
        loggerDo.debug('...request:')
        loggerDo.debug(request)

        loggerDo.debug('...asking server to serve_ ...');
        let response = await this.server.serve_allStorageStates(request);
        loggerDo.debug('...response:')
        loggerDo.debug(response);

        loggerDo.debug('...client is going to process_ ...');
        let outcome = await this.process_allStorageStates(response);
        loggerDo.debug('...outcome:')
        loggerDo.debug(outcome);

        loggerDo.debug('...client is going to update_ ...');
        await this.update_allStorageStates(outcome);
        loggerDo.debug('...client state:');
        loggerDo.debug(this.state);

        loggerDo.debug('...do_allStorageStates is done');
    }
    async process_allStorageStates(res: AllStorageStates_Response): Promise<AllStorageStates_Outcome> {
        loggerProcess.debug('process_allStorageStates...');
        let clientStorageSyncStates: Record<WorkspaceAddress, ClientStorageSyncState> = this.state.clientStorageSyncStates || {};
        for (let workspace of Object.keys(res)) {
            loggerProcess.debug(`  > workspace: ${workspace}`);
            let serverSyncState: ServerStorageSyncState = res[workspace];
            loggerProcess.debug(`    ServerStorageSyncState: ${J(serverSyncState)}`);
            if (workspace !== serverSyncState.workspaceAddress) {
                throw new ValidationError('server shenanigans: server response is not self-consistent, workspace key does not match data in the Record');
            }
            let clientStorage = this.peer.getStorage(workspace);
            if (clientStorage === undefined) {
                throw new ValidationError('server shenanigans: referenced a workspace we don\'t have');
            }
            let existingClientSyncState = this.state.clientStorageSyncStates[workspace] || {};
            let clientSyncState: ClientStorageSyncState = {
                workspaceAddress: serverSyncState.workspaceAddress,
                serverStorageId: serverSyncState.serverStorageId,
                serverMaxLocalIndexOverall: serverSyncState.serverMaxLocalIndexOverall,
                clientMaxLocalIndexOverall: clientStorage.getMaxLocalIndex(),
                // set maxIndexSoFar to -1 if it's missing, otherwise preserve the old value
                serverMaxLocalIndexSoFar: existingClientSyncState.serverMaxLocalIndexOverall ?? -1,
                clientMaxLocalIndexSoFar: existingClientSyncState.clientMaxLocalIndexOverall ?? -1,
                lastSeenAt: microsecondNow(),
            }
            loggerProcess.debug(`    new clientSyncState: ${J(clientSyncState)}`);
            clientStorageSyncStates[workspace] = clientSyncState;
        }
        loggerProcess.debug('...process_allStorageStates is done');
        return clientStorageSyncStates;
    }
    async update_allStorageStates(outcome: AllStorageStates_Outcome): Promise<void> {
        loggerUpdate.debug('updateAllStorageStates');
        loggerUpdate.debug('...just doing a setState...');
        this.setState({
            clientStorageSyncStates: outcome,
            lastSeenAt: microsecondNow(),
        });
        loggerUpdate.debug('...updateAllStorageStates is done');
    }
}
