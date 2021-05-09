import { WorkspaceAddress } from '../util/doc-types';
import { ICrypto } from '../crypto/crypto-types';
import { StorageId } from '../storage/storage-types';
import {
    IPeer,
    IPeerClient,
    IPeerServer,
    PeerId,
    saltAndHashWorkspace,
} from './peer-types';

import { microsecondNow } from '../util/misc';

//--------------------------------------------------

import { Logger } from '../util/log';
let logger = new Logger('peer client', 'greenBright');
let J = JSON.stringify;

//================================================================================

interface PeerInfo {
    peerId: PeerId,
    lastConnectedTimestamp: number,
    commonWorkspaces: WorkspaceAddress[],
    // TODO: we might want to access this by storageId, by workspace, or by peer + workspace...
    storageInfos: Map<StorageId, StorageInfo>,
}
interface StorageInfo {
    storageId: StorageId,
    peerId: PeerId,
    workspace: WorkspaceAddress,
    maxLocalIndexReceived: number,
    maxLocalIndexSent: number,
    // TODO: how to find out what the server wants from us?
}

export class PeerClient implements IPeerClient {
    // remember some things about each peer we've talked to
    peerInfos: Map<PeerId, PeerInfo>;

    constructor(public peer: IPeer, public crypto: ICrypto) {
        this.peerInfos = new Map<PeerId, PeerInfo>();
    }

    async syncWithPeer(server: IPeerServer): Promise<void> {
        logger.debug('sync');
        let commonWorkspaces = await this.discoverCommonWorkspaces(server);
        logger.debug(`...sync: got ${commonWorkspaces.length} common workspaces`);
        for (let workspace of commonWorkspaces) {
            logger.debug(`...sync: doing workspace "${workspace}"`);
            logger.debug(`...(TODO)`);
            // TODO: getDocuments(server, maxLocalIndex) and ingest them here
            // TODO: push documents from us to the server (which docs?)
        }
        logger.debug('...sync: done');
    }

    async discoverCommonWorkspaces(server: IPeerServer): Promise<WorkspaceAddress[]> {
        logger.debug(`discoverCommonWorkspaces`);

        // talk to server.  get peerId and salted workspaces
        let {
            peerId: serverPeerId,
            salt,
            saltedWorkspaces: serverSaltedWorkspaces
        } = await server.saltedWorkspaces();

        // figure out which workspaces we have in common
        let commonWorkspacesSet = new Set<string>();
        let serverSaltedSet = new Set<string>(serverSaltedWorkspaces);
        for (let myWorkspace of this.peer.workspaces()) {
            let mySalted = saltAndHashWorkspace(this.crypto, salt, myWorkspace);
            if (serverSaltedSet.has(mySalted)) {
                commonWorkspacesSet.add(myWorkspace);
            }
        }
        let commonWorkspaces = [...commonWorkspacesSet];
        commonWorkspaces.sort();

        // remember some facts about this server
        logger.debug('server details before:', this.peerInfos.get(serverPeerId));
        // load existing peerInfo
        let peerInfo: PeerInfo = this.peerInfos.get(serverPeerId) ?? {
            // ... or start with default empty peerInfo
            peerId: serverPeerId,
            lastConnectedTimestamp: -1,
            commonWorkspaces: [],
            storageInfos: new Map<StorageId, StorageInfo>(),
        };
        // update peerInfo
        peerInfo = {
            ...peerInfo,
            lastConnectedTimestamp: microsecondNow(),
            commonWorkspaces: commonWorkspaces,
        }
        this.peerInfos.set(serverPeerId, peerInfo);
        logger.debug('server details after:', peerInfo);

        logger.debug(`...${commonWorkspaces.length} common workspaces: ${J(commonWorkspaces)}`);
        return commonWorkspaces;
    }
}
