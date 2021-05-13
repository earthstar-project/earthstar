import { ICrypto } from '../crypto/crypto-types';
import {
    IPeer,
    IPeerServer,
    PeerId,
    SaltyHandshake_Request,
    SaltyHandshake_Response,
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
    // this does not affect any internal state, in fact
    // the server has no internal state (except maybe for
    // rate limiting, etc)
    async getPeerId(): Promise<PeerId> {
        return this.peer.peerId;
    }
    async serve_saltyHandshake(req: SaltyHandshake_Request): Promise<SaltyHandshake_Response> {
        loggerServe.debug('serve_saltyHandshake...');
        let salt = randomId();
        let saltedWorkspaces = this.peer.workspaces().map(ws =>
            saltAndHashWorkspace(this.crypto, salt, ws));
        let response: SaltyHandshake_Response = {
            serverPeerId: this.peer.peerId,
            salt,
            saltedWorkspaces,
        }
        loggerServe.debug('...serve_saltyHandshake is done:');
        loggerServe.debug(response);
        return response;
    }
}
