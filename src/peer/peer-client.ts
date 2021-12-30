import { WorkspaceAddress } from '../util/doc-types';
import { IngestEvent } from '../storage/storage-types';
import {
    AllWorkspaceStates_Request,
    AllWorkspaceStates_Response,
    IPeer,
    IPeerClient,
    IPeerServer,
    PeerClientState,
    PeerId,
    SaltyHandshake_Request,
    SaltyHandshake_Response,
    WorkspaceQuery_Request,
    WorkspaceQuery_Response,
    WorkspaceState,
    initialPeerClientState,
    saltAndHashWorkspace,
} from './peer-types';

import { sortedInPlace } from '../storage/compare';
import { microsecondNow } from '../util/misc';
import { ValidationError } from '../util/errors';

//--------------------------------------------------

import { Logger } from '../util/log';
import { write } from 'fs';
let logger = new Logger('peer client', 'greenBright');
let loggerDo = new Logger('peer client: do', 'green');
let loggerHandle = new Logger('peer client: handle', 'cyan');
let loggerProcess = new Logger('peer client: process', 'cyan');
let J = JSON.stringify;

//================================================================================

export class PeerClient implements IPeerClient {
    peer: IPeer;
    server: IPeerServer;

    state: PeerClientState = { ...initialPeerClientState };

    // Each client only talks to one server.
    constructor(peer: IPeer, server: IPeerServer) {
        // TODO: load / save the client state (to where?)

        logger.debug('peerClient constructor');
        this.peer = peer;
        this.server = server;
        logger.debug(`...peerId: ${this.peer.peerId}`);
        logger.debug(`...client initial state:`);
        logger.debug(this.state);
    }

    async setState(newState: Partial<PeerClientState>): Promise<void> {
        // if peerId changes, reset state
        if (newState.serverPeerId !== null && newState.serverPeerId !== undefined) {
            if (this.state.serverPeerId !== null) {
                if (newState.serverPeerId !== this.state.serverPeerId) {
                    logger.warn(`server has changed peer ID from ${this.state.serverPeerId} to ${newState.serverPeerId}; resetting PeerClient state`);
                    this.state = { ...initialPeerClientState };
                }
            }
        }
        this.state = { ...this.state, ...newState };
    }

    //--------------------------------------------------
    // GET SERVER PEER ID

    async do_getServerPeerId(): Promise<PeerId> {
        let serverPeerId = await this.server.serve_peerId();
        // setState will detect if the server peerId
        // has changed, and reset our own state.
        await this.setState({
            serverPeerId,
            lastSeenAt: microsecondNow(),
        });
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

        loggerDo.debug('...client is going to handle_ ...');
        let stateUpdate = await this.handle_saltyHandshake(response);

        loggerDo.debug('...state update:')
        loggerDo.debug(stateUpdate);
        loggerDo.debug('...setting state...')
        await this.setState(stateUpdate);
        loggerDo.debug('...new combined state:')
        loggerDo.debug(this.state);

        loggerDo.debug('...do_saltyHandshake is done');
    }

    async handle_saltyHandshake(response: SaltyHandshake_Response): Promise<Partial<PeerClientState>> {
        loggerHandle.debug('handle_saltyHandshake...');
        let { serverPeerId, salt, saltedWorkspaces } = response;

        // figure out which workspaces we have in common
        // by salting and hashing our own workspaces in the same way
        // the server did, and seeing what matches
        loggerHandle.debug('...salting and hashing my own workspaces and comparing with server...');
        let serverSaltedSet = new Set<string>(saltedWorkspaces);
        let commonWorkspaceSet = new Set<WorkspaceAddress>();
        for (let plainWs of this.peer.workspaces()) {
            let saltedWs = await saltAndHashWorkspace(salt, plainWs);
            if (serverSaltedSet.has(saltedWs)) {
                commonWorkspaceSet.add(plainWs);
            }
        }
        let commonWorkspaces = sortedInPlace([...commonWorkspaceSet]);

        loggerHandle.debug(`...server has ${saltedWorkspaces.length} workspaces; we have ${this.peer.workspaces().length}; and ${commonWorkspaces.length} are in common`);
        loggerHandle.debug(`...handle_saltyHandshake is done.`);

        // make a state update
        return {
            serverPeerId,
            commonWorkspaces,
            lastSeenAt: microsecondNow(),
        };
    }

    //--------------------------------------------------
    // ALL STORAGE STATES

    async do_allWorkspaceStates(): Promise<void> {
        loggerDo.debug('do_allWorkspaceStates...');
        loggerDo.debug('...initial client state:');
        loggerDo.debug(this.state);

        // nothing to ask about?
        if (this.state.commonWorkspaces === null || this.state.commonWorkspaces.length === 0) {
            loggerDo.debug('...actually there are no common workspaces to ask about, so quitting early');
            return;
        }

        let request: AllWorkspaceStates_Request = {
            commonWorkspaces: this.state.commonWorkspaces || [],
        };
        loggerDo.debug('...request:')
        loggerDo.debug(request)

        loggerDo.debug('...asking server to serve_ ...');
        let response = await this.server.serve_allWorkspaceStates(request);
        loggerDo.debug('...response:')
        loggerDo.debug(response);

        loggerDo.debug('...client is going to handle_ ...');
        let stateUpdate = await this.handle_allWorkspaceStates(request, response);

        loggerDo.debug('...state update:')
        loggerDo.debug(stateUpdate);
        loggerDo.debug('...setting state...')
        await this.setState(stateUpdate);
        loggerDo.debug('...new combined state:')
        loggerDo.debug(this.state);

        loggerDo.debug('...do_allWorkspaceStates is done');
    }

    async handle_allWorkspaceStates(request: AllWorkspaceStates_Request, response: AllWorkspaceStates_Response): Promise<Partial<PeerClientState>> {
        // request is provided here so we can check for consistency in case the server replied with
        // something totally different

        loggerHandle.debug('handle_allWorkspaceStates...');
        let { commonWorkspaces } = request;
        let { serverPeerId, workspaceStatesFromServer } = response;

        let newWorkspaceStates: Record<WorkspaceAddress, WorkspaceState> = {};
        for (let workspace of Object.keys(workspaceStatesFromServer)) {
            loggerHandle.debug(`  > ${workspace}`);
            let workspaceStateFromServer = workspaceStatesFromServer[workspace];
            if (workspaceStateFromServer.workspace !== workspace) {
                throw new ValidationError(`server shenanigans: server response is not self-consistent, workspace key does not match data in the Record ${workspaceStateFromServer.workspace} & ${workspace}`);
            }
            if (commonWorkspaces.indexOf(workspace) === -1) {
                throw new ValidationError(`server shenanigans: server included a workspace that is not common: ${workspace}`);
            }
            let clientStorage = this.peer.getStorage(workspace);
            if (clientStorage === undefined) {
                throw new ValidationError(`server shenanigans: referenced a workspace we don't have: ${workspace}`);
            }
            let existingWorkspaceState = this.state.workspaceStates[workspace] || {};
            newWorkspaceStates[workspace] = {
                workspace,

                serverStorageId: workspaceStateFromServer.serverStorageId,
                serverMaxLocalIndexOverall: workspaceStateFromServer.serverMaxLocalIndexOverall,
                // set maxIndexSoFar to -1 if it's missing, otherwise preserve the old value
                serverMaxLocalIndexSoFar: existingWorkspaceState.serverMaxLocalIndexSoFar ?? -1,

                // TODO: check if client storage id has changed, and if so reset this state
                clientStorageId: clientStorage.storageId,
                clientMaxLocalIndexOverall: clientStorage.getMaxLocalIndex(),
                // set maxIndexSoFar to -1 if it's missing, otherwise preserve the old value
                clientMaxLocalIndexSoFar: existingWorkspaceState.clientMaxLocalIndexSoFar ?? -1,

                lastSeenAt: microsecondNow(),
            }
        }

        loggerHandle.debug('...handle_allWorkspaceStates is done');
        return {
            serverPeerId,
            // TODO: should this merge with, or overwrite, the existing one?
            // we've incorporated the existing one into this one already, so we should
            // have checked if the serverPeerId has changed also...
            workspaceStates: newWorkspaceStates,
            lastSeenAt: microsecondNow(),
        }
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
        // returns the number of docs pulled, even if they were obsolete or we alreayd had them.

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

        let myWorkspaceState = this.state.workspaceStates[workspace];
        if (storageId !== myWorkspaceState.serverStorageId) {
            let err = `storageId for ${workspace} is not ${storageId} anymore, it's ${myWorkspaceState.serverStorageId}`;
            loggerProcess.error(err);
            throw err;
        }

        // ingest the docs
        let numPulled = 0;
        for (let doc of docs) {
            loggerProcess.debug('trying to ingest a doc', doc);
            // get the workspace every time in case something else is changing it?
            let myWorkspaceState = this.state.workspaceStates[workspace];
            // TODO: keep checking if storageId has changed every time

            // save the doc
            let ingestEvent = await storage.ingest(doc);
            if (ingestEvent.kind === 'failure') {
                loggerProcess.error('doc was not written.');
                loggerProcess.error('...reason', ingestEvent.reason);
                loggerProcess.error('...err', ingestEvent.err);
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
            myWorkspaceState = {
                ...myWorkspaceState,
                serverMaxLocalIndexOverall,
                serverMaxLocalIndexSoFar: doc._localIndex ?? -1,
                lastSeenAt: microsecondNow(),
            }
            await this.setState({
                workspaceStates: {
                    ...this.state.workspaceStates,
                    [workspace]: myWorkspaceState,
                },
                lastSeenAt: microsecondNow(),
            });
        }
        loggerProcess.debug(`...done ingesting ${numPulled} docs`);
        loggerProcess.debug('...process_workspaceQuery is done.');
        return numPulled;
    }
}

