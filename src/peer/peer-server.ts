import { ICrypto } from '../crypto/crypto-types';
import {
    IPeer,
    IPeerServer,
    SaltAndSaltedWorkspaces,
    saltAndHashWorkspace,
} from './peer-types';

//--------------------------------------------------

import { Logger } from '../util/log';
let logger = new Logger('peer server', 'yellowBright');
let J = JSON.stringify;

//================================================================================

export class PeerServer implements IPeerServer {
    constructor(public peer: IPeer, public crypto: ICrypto) {
    }
    async saltedWorkspaces(): Promise<SaltAndSaltedWorkspaces> {
        let salt = '' + Math.random() + Math.random() + Math.random() + Math.random() + Math.random();
        let saltedWorkspaces = this.peer.workspaces()
            .map(ws => saltAndHashWorkspace(this.crypto, salt, ws));
        let result = {
            peerId: this.peer.peerId,
            salt,
            saltedWorkspaces,
        }
        logger.debug(`saltedWorkspaces: ${J(result, null, 2)}`);
        return result;
    }
}
