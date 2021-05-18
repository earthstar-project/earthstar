import { Doc, WorkspaceAddress } from '../util/doc-types';
import { IStorageAsync, StorageId } from '../storage/storage-types';
import { ICrypto } from '../crypto/crypto-types';
import { Query } from '../query/query-types';

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
    getStorage(ws: WorkspaceAddress): IStorageAsync | undefined;

    // setters
    addStorage(storage: IStorageAsync): Promise<void>;
    removeStorageByWorkspace(workspace: WorkspaceAddress): Promise<void> 
    removeStorage(storage: IStorageAsync): Promise<void>;
}

//================================================================================
// CLIENT AND SERVER

/**
 * API endpoints follow some similar patterns:
 * 
 *   - Client always initiates contact.
 *   - client_do_thing(thing_request) => void -- handles all the following calls:
 *   -     client asks for server.serve_thing(thing_request) => thing_response
 *   -     client.transform_thing(thing_response) => thing_outcome
 *   -     client.update_thing(thing_outcome) => void
 *
 *    FUNCTION             DATA TYPE
 * 
 *                         x_request
 *    client.do_x
 *      server.serve_x
 *                         x_response
 *      client.transform_x
 *                         x_outcome
 *      client.update_x
 *                         void 
 * 
 * And sometimes instead of transform-and-update, we have a single step "process":
 * 
 *   - client_do_thing(thing_request) => void -- handles all the following calls:
 *   -     client asks for server.serve_thing(thing_request) => thing_response
 *   -     client.process_thing(thing_response) => void
 * 
 *    FUNCTION             DATA TYPE
 * 
 *                         x_request
 *    client.do_x
 *      server.serve_x
 *                         x_response
 *      client.process_x
 *                         void 
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

//--------------------------------------------------
// ask server for all storage states

export interface AllWorkspaceStates_Request {
    commonWorkspaces: WorkspaceAddress[],
}
export type AllWorkspaceStates_Response = Record<WorkspaceAddress, WorkspaceStateFromServer>;
export type AllWorkspaceStates_Outcome = Record<WorkspaceAddress, WorkspaceState>;

//--------------------------------------------------
// do a query for one workspace, one server
// this only pulls client<--server, does not push client-->server

export interface WorkspaceQuery_Request {
    workspace: WorkspaceAddress,
    storageId: StorageId,
    query: Query,
}
export interface WorkspaceQuery_Response {
    workspace: WorkspaceAddress,
    storageId: StorageId,
    serverMaxLocalIndexOverall: number,
    docs: Doc[],
}

//--------------------------------------------------

// Data we learn from talking to the server.
// Null means not known yet.
// This should be easily serializable.
export interface PeerClientState {
    serverPeerId: PeerId | null;
    // TODO: commonWorkspaces could be merged with storageSyncStates?
    commonWorkspaces: WorkspaceAddress[] | null;
    workspaceStates: Record<WorkspaceAddress, WorkspaceState>;
    lastSeenAt: number | null,  // a timestamp in Earthstar-style microseconds
}
export interface WorkspaceStateFromServer {
    workspaceAddress: WorkspaceAddress,
    serverStorageId: StorageId;
    serverMaxLocalIndexOverall: number,
}
export interface WorkspaceState {
    workspaceAddress: WorkspaceAddress,
    serverStorageId: StorageId;
    serverMaxLocalIndexOverall: number,
    clientMaxLocalIndexOverall: number,
    serverMaxLocalIndexSoFar: number,  // -1 if unknown
    clientMaxLocalIndexSoFar: number,  // -1 if unknown
    lastSeenAt: number,
}

export let initialPeerClientState: PeerClientState = {
    serverPeerId: null,
    commonWorkspaces: null,
    workspaceStates: {},
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

    // do_: do the entire thing
    // process and update are split into two functions
    // for easier testing.
    // transform_: this does any computation or complex work needed to boil this down
    // into a simple state update, but it does not actually update our state,
    // it just returns the changes to the state
    // update_: this applies the changes to the state

    do_saltyHandshake(): Promise<void>;
    //transform_saltyHandshake(res: SaltyHandshake_Response): Promise<SaltyHandshake_Outcome>;
    //update_saltyHandshake(outcome: SaltyHandshake_Outcome): Promise<void>;

    handle_saltyHandshake(res: SaltyHandshake_Response): Partial<PeerClientState>;

    do_allWorkspaceStates(): Promise<void>;
    transform_allWorkspaceStates(res: AllWorkspaceStates_Response): Promise<AllWorkspaceStates_Outcome>;
    update_allWorkspaceStates(outcome: AllWorkspaceStates_Outcome): Promise<void>;

    // return number of docs obtained that were not invalid
    do_workspaceQuery(request: WorkspaceQuery_Request): Promise<number>;
    process_workspaceQuery(response: WorkspaceQuery_Response): Promise<number>;
}

//--------------------------------------------------

export interface IPeerServer {
    // this does not affect any internal state, in fact
    // the server has no internal state (except maybe for
    // rate limiting, etc)

    getPeerId(): Promise<PeerId>;

    serve_saltyHandshake(req: SaltyHandshake_Request): Promise<SaltyHandshake_Response>;
    serve_allWorkspaceStates(req: AllWorkspaceStates_Request): Promise<AllWorkspaceStates_Response>;
    serve_workspaceQuery(request: WorkspaceQuery_Request): Promise<WorkspaceQuery_Response>;
}
