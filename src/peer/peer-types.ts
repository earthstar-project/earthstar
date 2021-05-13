import { WorkspaceAddress } from '../util/doc-types';
import { IStorageAsync } from '../storage/storage-types';
import { ICrypto } from '../crypto/crypto-types';
import { Peer } from './peer';
import { PeerClient } from './peer-client';

//================================================================================
// PEER

export type PeerId = string;

export interface IPeer {
    // TODO: oops, or should we have storage IDs instead of peer IDs?
    peerId: PeerId,

    // getters
    hasWorkspace(workspace: WorkspaceAddress): boolean;
    workspaces(): WorkspaceAddress[];
    storages(): IStorageAsync[];
    size(): number;

    // setters
    addStorage(storage: IStorageAsync): Promise<void>;
    removeStorageByWorkspace(workspace: WorkspaceAddress): Promise<void> 
    removeStorage(storage: IStorageAsync): Promise<void>;
}

//================================================================================
// CLIENT AND SERVER

/**
 * Every kind of API endpoint follows the same pattern here:
 *   - Client always initiates contact.
 *   - client.do_thing(thing_request) => void
 *   -     client asks for server.serve_thing(thing_request) => thing_response
 *   -     client.process_thing(thing_response) => thing_outcome
 *   -     client.update_thing(thing_outcome) => void
 *
 *    FUNCTION             DATA TYPE
 * 
 *                         x_request
 *    client.do_x
 *      server.serve_x
 *                         x_response
 *      client.process_x
 *                         x_outcome
 *      client.update_x
 *                         void 
 * 
 */

// ok this isn't a type, but I put it here anyway since it's shared code for client and server
export let saltAndHashWorkspace = (crypto: ICrypto, salt: string, workspace: WorkspaceAddress): string =>
    crypto.sha256base32(salt + workspace + salt);

//--------------------------------------------------
// SALTY HANDSHAKE

export interface SaltyHandshake_Request {
}
export interface SaltyHandshake_Response {
    serverPeerId: PeerId,
    salt: string,
    saltedWorkspaces: string[],
}
export interface SaltyHandshake_Outcome {
    serverPeerId: PeerId
    commonWorkspaces: WorkspaceAddress[],
}

//--------------------------------------------------

// Data we learn from talking to the server.
// Null means not known yet.
// This should be easily serializable.
export interface PeerClientState {
    serverPeerId: PeerId | null;
    commonWorkspaces: WorkspaceAddress[] | null;
    lastSeenAt: number | null,  // a timestamp in Earthstar-style microseconds
}

export let initialPeerClientState: PeerClientState = {
    serverPeerId: null,
    commonWorkspaces: null,
    lastSeenAt: null,
}

export interface IPeerClient {
    // Each client only talks to one server.

    // this is async in case we later want to set up
    // a message bus that alerts when the state is changed
    setState(newState: Partial<PeerClientState>): Promise<void>;

    // get and return the server's peerId.
    // this can be used as a ping.
    getServerPeerId(): Promise<PeerId>;

    // do the entire thing
    do_saltyHandshake(): Promise<void>;

    // process and update are split into two functions
    // for easier testing.

    // this does any computation or complex work needed to boil this down
    // into a simple state update, but it does not actually update our state,
    // it just returns the changes to the state
    process_saltyHandshake(res: SaltyHandshake_Response): Promise<SaltyHandshake_Outcome>;

    // this applies the changes to the state
    update_saltyHandshake(outcome: SaltyHandshake_Outcome): Promise<void>;

}

//--------------------------------------------------

export interface IPeerServer {
    // this does not affect any internal state, in fact
    // the server has no internal state (except maybe for
    // rate limiting, etc)

    getPeerId(): Promise<PeerId>;
    serve_saltyHandshake(req: SaltyHandshake_Request): Promise<SaltyHandshake_Response>;
}
