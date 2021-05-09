import { WorkspaceAddress } from '../util/doc-types';
import { ICrypto } from '../crypto/crypto-types';
import { StorageId } from '../storage/storage-types';
import {
    CommonWorkspacesAndPeerId,
    IPeer,
    IPeerClient,
    IPeerServer,
    PeerId,
    saltAndHashWorkspace,
} from './peer-types';

import { microsecondNow } from '../util/misc';
import { sortedInPlace } from '../storage/compare';

//--------------------------------------------------

import { Logger } from '../util/log';
import { workspaceAddressChars } from '../core-validators/characters';
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

let _defaultPeerInfo = (peerId: PeerId): PeerInfo => ({
    peerId,
    lastConnectedTimestamp: microsecondNow(),
    commonWorkspaces: [],
    storageInfos: new Map<StorageId, StorageInfo>(),
});

export class PeerClient implements IPeerClient {
    // remember some things about each peer we've talked to
    peerInfos: Map<PeerId, PeerInfo>;

    constructor(public peer: IPeer, public crypto: ICrypto) {
        this.peerInfos = new Map<PeerId, PeerInfo>();
    }

    async syncWithPeer(server: IPeerServer): Promise<void> {
        logger.debug('sync');
        let { commonWorkspaces, serverPeerId } =
            await this.discoverCommonWorkspacesAndServerPeerId(server);
        logger.debug(`...sync: got ${commonWorkspaces.length} common workspaces`);

        // TODO: request info about storages we have in common

        let peerInfo = this.peerInfos.get(serverPeerId) ?? _defaultPeerInfo(serverPeerId);

        for (let workspace of commonWorkspaces) {
            logger.debug(`...sync: doing workspace "${workspace}"`);
            let storageInfo = peerInfo.storageInfos.get(workspace);
            if (storageInfo === undefined) {
                logger.debug(`...sync: ...we have not synced this workspace before`);
                // TODO: get details of other storage: its storageId and maxLocalIndex
                // so we can fill out a storageInfo for it
            } else {
                logger.debug(`...sync: ...we HAVE synced this workspace before:`);
                logger.debug(storageInfo);
            }
        }

        /*
        for (let storageInfo of peerInfo.storageInfos.values()) {
            if (commonWorkspaces.indexOf(storageInfo.workspace) === -1) {
                // skip this storage, it's not a workspace we have in common
                continue;
            }
            logger.debug(`...sync: doing workspace "${storageInfo.workspace}"`);
            logger.debug(`...sync: so far, max local index received = ${storageInfo.maxLocalIndexReceived}`);
            logger.debug(`...sync: so far, max local index sent = ${storageInfo.maxLocalIndexSent}`);
        }
        */

        /*
        for (let workspace of commonWorkspaces) {
            logger.debug(`...sync: doing workspace "${workspace}"`);
            logger.debug(`...(TODO)`);


            // TODO: getDocuments(server, maxLocalIndex) and ingest them here
            // TODO: push documents from us to the server (which docs?)
        }
        */

        logger.debug('...sync: done');
    }

    async syncWorkspace(server: IPeerServer): Promise<void> {
    }

    /**
     * This is the first step in talking with a server, so we discover a couple of things:
     * - common workspaces
     * - server's peerId
     */
    async discoverCommonWorkspacesAndServerPeerId(server: IPeerServer): Promise<CommonWorkspacesAndPeerId> {
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
        let commonWorkspaces = sortedInPlace([...commonWorkspacesSet]);

        // remember some facts about this server
        logger.debug('server details before:', this.peerInfos.get(serverPeerId));
        // load existing peerInfo
        let peerInfo: PeerInfo = this.peerInfos.get(serverPeerId) ?? _defaultPeerInfo(serverPeerId);
        // update peerInfo
        peerInfo = {
            ...peerInfo,
            lastConnectedTimestamp: microsecondNow(),
            commonWorkspaces: commonWorkspaces,
        }
        this.peerInfos.set(serverPeerId, peerInfo);
        logger.debug('server details after:', peerInfo);

        logger.debug(`...${commonWorkspaces.length} common workspaces: ${J(commonWorkspaces)}`);
        return {
            commonWorkspaces,
            serverPeerId,
        }
    }
}
