import { Doc } from '../util/doc-types';
import { ICrypto } from '../crypto/crypto-types';
import {
    AllWorkspaceStates_Request,
    AllWorkspaceStates_Response,
    IPeer,
    IPeerServer,
    PeerId,
    SaltyHandshake_Request,
    SaltyHandshake_Response,
    WorkspaceQuery_Request,
    WorkspaceQuery_Response,
    WorkspaceStateFromServer,
    saltAndHashWorkspace,
} from "./peer-types";

import { randomId } from '../util/misc';

//--------------------------------------------------

import { Logger } from '../util/log';
let logger = new Logger('peer server', 'magentaBright');
let loggerServe = new Logger('peer server: serve', 'magenta');
let J = JSON.stringify;

//================================================================================

export class PeerServer implements IPeerServer {
    crypto: ICrypto;
    peer: IPeer;
    constructor(crypto: ICrypto, peer: IPeer) {
        logger.debug('peerServer constructor');
        this.crypto = crypto;
        this.peer = peer;
        logger.debug(`...peerId: ${this.peer.peerId}`);
    }

    async getPeerId(): Promise<PeerId> {
        return this.peer.peerId;
    }

    async serve_saltyHandshake(req: SaltyHandshake_Request): Promise<SaltyHandshake_Response> {
        // request is empty and unused
        loggerServe.debug('serve_saltyHandshake...');
        let salt = randomId();
        let saltedWorkspaces = this.peer.workspaces().map(ws =>
            saltAndHashWorkspace(this.crypto, salt, ws));
        loggerServe.debug(`...serve_saltyHandshake is done.  found ${saltedWorkspaces.length} workspaces.`);
        return {
            serverPeerId: this.peer.peerId,
            salt,
            saltedWorkspaces,
        }
    }

    async serve_allWorkspaceStates(req: AllWorkspaceStates_Request): Promise<AllWorkspaceStates_Response> {
        loggerServe.debug('serve_allWorkspaceStates...')
        let response: AllWorkspaceStates_Response = {};
        for (let workspace of req.commonWorkspaces) {
            let storage = this.peer.getStorage(workspace);
            if (storage === undefined) {
                loggerServe.debug(`workspace ${workspace} is unknown??; skipping`);
                continue;
            }
            let workspaceStateFromServer: WorkspaceStateFromServer = {
                workspaceAddress: workspace,
                serverStorageId: storage.storageId,
                serverMaxLocalIndexOverall: storage.getMaxLocalIndex(),
            };
            response[workspace] = workspaceStateFromServer;
        }
        loggerServe.debug('...serve_allWorkspaceStates is done.')
        return response;
    }

    async serve_workspaceQuery(request: WorkspaceQuery_Request): Promise<WorkspaceQuery_Response> {
        // TODO: enforce a certain limit on queries so they can't just get everything all at once
        let { workspace, storageId, query } = request;
        loggerServe.debug('serve_workspaceQuery...')
        let storage = this.peer.getStorage(workspace);
        if (storage === undefined) {
            let err = `workspace ${workspace} is unknown; skipping`;
            loggerServe.debug(err);
            throw err;
        }
        if (storage.storageId !== storageId) {
            let err = `storageId for ${workspace} is not ${storageId} anymore, it's ${storage.storageId}`;
            loggerServe.debug(err);
            throw err;
        }
        loggerServe.debug('...querying storage for docs')
        let docs: Doc[] = await storage.queryDocs(query);
        loggerServe.debug(`...got ${docs.length} docs`)
        loggerServe.debug('...serve_workspaceQuery is done')
        return {
            workspace,
            storageId,
            serverMaxLocalIndexOverall: storage.getMaxLocalIndex(),
            docs,
        }
    }
}
