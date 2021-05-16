import { WorkspaceAddress } from '../util/doc-types';
import { ICrypto } from '../crypto/crypto-types';
import {
    AllStorageStates_Outcome,
    AllStorageStates_Request,
    AllStorageStates_Response,
    ClientStorageSyncState,
    IPeer,
    IPeerClient,
    IPeerServer,
    PeerClientState,
    PeerId,
    SaltyHandshake_Outcome,
    SaltyHandshake_Request,
    SaltyHandshake_Response,
    ServerStorageSyncState,
    WorkspaceQuery_Request,
    WorkspaceQuery_Response,
    initialPeerClientState,
    saltAndHashWorkspace,
} from './peer-types';
import { sortedInPlace } from '../storage/compare';
import { microsecondNow } from '../util/misc';
import { ValidationError } from '../util/errors';

//--------------------------------------------------

import { Logger } from '../util/log';
import { IngestResult } from '../storage/storage-types';
let logger = new Logger('peer client', 'greenBright');
let loggerDo = new Logger('peer client: do', 'green');
let loggerTransform = new Logger('peer client: transform', 'cyan');
let loggerUpdate = new Logger('peer client: update', 'blue');
let loggerProcess = new Logger('peer client: process', 'cyan');
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
        loggerDo.debug('...initial client state:');
        loggerDo.debug(this.state);

        let request: SaltyHandshake_Request = {};
        loggerDo.debug('...request:')
        loggerDo.debug(request)

        loggerDo.debug('...asking server to serve_ ...');
        let response = await this.server.serve_saltyHandshake(request);
        loggerDo.debug('...response:')
        loggerDo.debug(response);

        loggerDo.debug('...client is going to transform_ ...');
        let outcome = await this.transform_saltyHandshake(response);
        loggerDo.debug('...outcome:')
        loggerDo.debug(outcome);

        loggerDo.debug('...client is going to update_ ...');
        await this.update_saltyHandshake(outcome);
        loggerDo.debug('...client state:');
        loggerDo.debug(this.state);

        loggerDo.debug('...do_saltyHandshake is done');
    }

    async transform_saltyHandshake(res: SaltyHandshake_Response): Promise<SaltyHandshake_Outcome> {
        loggerTransform.debug('transform_saltyHandshake...');

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

        loggerTransform.debug('...transform_saltyHandshake is done.');
        return {
            serverPeerId: res.serverPeerId,
            commonWorkspaces,
        };
    }

    async update_saltyHandshake(outcome: SaltyHandshake_Outcome): Promise<void> {
        loggerUpdate.debug('update_saltyHandshake...');
        await this.setState({
            serverPeerId: outcome.serverPeerId,
            commonWorkspaces: outcome.commonWorkspaces,
            lastSeenAt: microsecondNow(),
        });
        loggerUpdate.debug('...update_saltyHandshake is done.');
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

        loggerDo.debug('...client is going to transform_ ...');
        let outcome = await this.transform_allStorageStates(response);
        loggerDo.debug('...outcome:')
        loggerDo.debug(outcome);

        loggerDo.debug('...client is going to update_ ...');
        await this.update_allStorageStates(outcome);
        loggerDo.debug('...client state:');
        loggerDo.debug(this.state);

        loggerDo.debug('...do_allStorageStates is done');
    }
    async transform_allStorageStates(res: AllStorageStates_Response): Promise<AllStorageStates_Outcome> {
        loggerTransform.debug('transform_allStorageStates...');
        let clientStorageSyncStates: Record<WorkspaceAddress, ClientStorageSyncState> = this.state.clientStorageSyncStates || {};
        for (let workspace of Object.keys(res)) {
            loggerTransform.debug(`  > workspace: ${workspace}`);
            let serverSyncState: ServerStorageSyncState = res[workspace];
            loggerTransform.debug(`    ServerStorageSyncState: ${J(serverSyncState)}`);
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
            loggerTransform.debug(`    new clientSyncState: ${J(clientSyncState)}`);
            clientStorageSyncStates[workspace] = clientSyncState;
        }
        loggerTransform.debug('...transform_allStorageStates is done');
        return clientStorageSyncStates;
    }
    async update_allStorageStates(outcome: AllStorageStates_Outcome): Promise<void> {
        loggerUpdate.debug('updateAllStorageStates');
        this.setState({
            clientStorageSyncStates: outcome,
            lastSeenAt: microsecondNow(),
        });
        loggerUpdate.debug('...updateAllStorageStates is done.');
    }

    //--------------------------------------------------
    // WORKSPACE QUERY

    async do_workspaceQuery(request: WorkspaceQuery_Request): Promise<number> {
        loggerDo.debug('do_workspaceQuery...');
        loggerDo.debug('...initial client state:');
        loggerDo.debug(this.state);
        loggerDo.debug('...request:')
        loggerDo.debug(request)

        loggerDo.debug('...asking server to serve_ ...');
        let response = await this.server.serve_workspaceQuery(request);
        loggerDo.debug('...response:')
        loggerDo.debug(response);

        loggerDo.debug('...client is going to process_ ...');
        let numPulled = await this.process_workspaceQuery(response);
        loggerDo.debug(`...pulled ${numPulled} docs`);

        loggerDo.debug('...final client state:');
        loggerDo.debug(this.state);

        loggerDo.debug('...do_workspaceQuery is done');
        return numPulled;
    }

    async process_workspaceQuery(response: WorkspaceQuery_Response): Promise<number> {
        loggerProcess.debug('process_workspaceQuery');
        let {
            workspace,
            storageId,
            serverMaxLocalIndexOverall,
            docs,
        } = response;
        // TODO: we need to compare this with the request to make sure
        // the server didn't switch the workspace or storageId on us...
        // maybe that can happen in do_...

        // get the storage
        let storage = this.peer.getStorage(workspace);
        if (storage === undefined) {
            let err = `workspace ${workspace} is unknown; skipping`;
            loggerProcess.error(err);
            throw err;
        }

        let syncState = this.state.clientStorageSyncStates[workspace];
        if (storageId !== syncState.serverStorageId) {
            let err = `storageId for ${workspace} is not ${storageId} anymore, it's ${syncState.serverStorageId}`;
            loggerProcess.error(err);
            throw err;
        }

        // ingest the docs
        let numPulled = 0;
        for (let doc of docs) {
            loggerProcess.debug('trying to ingest a doc', doc);
            let clientStorageSyncState = this.state.clientStorageSyncStates[workspace];
            // TODO: keep checking if storageId has changed every time
            let {ingestResult, docIngested } = await storage.ingest(doc);
            if (ingestResult === IngestResult.Invalid || ingestResult === IngestResult.WriteError) {
                loggerProcess.error('doc was not written.');
                loggerProcess.error('...ingestResult', ingestResult);
                loggerProcess.error('...doc', doc);
                loggerProcess.error('if it is invalid, it might be from the future;');
                loggerProcess.error('we will need to try again later.');
                // TODO: big problem:
                // If the server gives a doc from the future, it will be invalid
                // so we can't ingest it.  We will need to get it in a future
                // query so we can ingest it then.
                // So what do we do with our record of the server's maxIndexSoFar?
                // I think we have to abort here and try continuing later,
                // otherwise we'll leave a gap and that doc-from-the-future
                // will never get synced.
                // BUT this means a single invalid doc can block syncing forever.
                // We need to know if it's invalid because it's from the future,
                // in which case we should stop and try later, or if it's
                // invalid for another reason, in which case we should ignore it
                // and continue.
                break;
            }
            numPulled += 1;
            clientStorageSyncState = {
                ...clientStorageSyncState,
                serverMaxLocalIndexOverall,
                serverMaxLocalIndexSoFar: doc._localIndex ?? -1,
                lastSeenAt: microsecondNow(),
            }
            this.setState({
                clientStorageSyncStates: {
                    ...this.state.clientStorageSyncStates,
                    [workspace]: clientStorageSyncState,
                },
                lastSeenAt: microsecondNow(),
            });
        }
        loggerProcess.debug(`...done ingesting ${numPulled} docs`);
        loggerProcess.debug('...process_workspaceQuery is done.');
        return numPulled;
    }
}

