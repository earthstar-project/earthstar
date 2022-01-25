import { Doc, WorkspaceAddress } from "../util/doc-types.ts";
import { IStorageAsync, StorageId } from "../storage/storage-types.ts";
import { Query } from "../query/query-types.ts";
import { Crypto } from "../crypto/crypto.ts";

//================================================================================
// PEER

export type PeerId = string;

/** Holds many shares' replicas and manages their synchronisation with other peers. Recommended as the point of contact between your application and Earthstar shares. */
export interface IPeer {
    // TODO: oops, or should we have storage IDs instead of peer IDs?
    peerId: PeerId;

    // getters
    hasWorkspace(workspace: WorkspaceAddress): boolean;
    workspaces(): WorkspaceAddress[];
    storages(): IStorageAsync[];
    size(): number;
    getStorage(ws: WorkspaceAddress): IStorageAsync | undefined;

    // setters
    addStorage(storage: IStorageAsync): Promise<void>;
    removeStorageByWorkspace(workspace: WorkspaceAddress): Promise<void>;
    removeStorage(storage: IStorageAsync): Promise<void>;
}

//================================================================================
// CLIENT AND SERVER

/**
 * API endpoints follow some similar patterns:
 *
 * ## Do, Serve, Handle
 *
 *   - Client always initiates contact.
 *   - client_do_thing(thing_request) => void -- handles all the following calls:
 *   -     client asks for server.serve_thing(thing_request) => thing_response
 *   -     client.handle_thing(thing_response) => newState
 *   -     client.setState(newState)
 *
 *    FUNCTION             DATA TYPE
 *
 *                         x_request
 *    client.do_x
 *      server.serve_x
 *                         x_response
 *      client.handle_x
 *                         Partial<PeerClientState>
 *
 * ## Do, Serve, Process
 *
 * This is used when the client needs to perform some side-effects besides just
 * updating its own client state.  For example, ingesting docs.  It also lets
 * the overall return value of process_x and do_x be something more useful,
 * like the number of docs ingested.
 *
 *   - client_do_thing(thing_request) => ? -- handles all the following calls:
 *   -     client asks for server.serve_thing(thing_request) => thing_response
 *   -     client.process_thing(thing_response) => ?
 *
 *    FUNCTION             DATA TYPE
 *
 *                         x_request
 *    client.do_x
 *      server.serve_x
 *                         x_response
 *      client.process_x
 *                         ?
 */

// ok this isn't a type, but I put it here anyway since it's shared code for client and server
export function saltAndHashWorkspace(
    salt: string,
    workspace: WorkspaceAddress,
): Promise<string> {
    return Crypto.sha256base32(salt + workspace + salt);
}

//--------------------------------------------------
// SALTY HANDSHAKE

export interface SaltyHandshake_Request {
}
export interface SaltyHandshake_Response {
    serverPeerId: PeerId;
    salt: string;
    saltedWorkspaces: string[];
}

//--------------------------------------------------
// ask server for all storage states

export interface AllWorkspaceStates_Request {
    commonWorkspaces: WorkspaceAddress[];
}
export type AllWorkspaceStates_Response = {
    serverPeerId: PeerId;
    workspaceStatesFromServer: Record<
        WorkspaceAddress,
        WorkspaceStateFromServer
    >;
};
export type AllWorkspaceStates_Outcome = Record<
    WorkspaceAddress,
    WorkspaceState
>;

//--------------------------------------------------
// do a query for one workspace, one server
// this only pulls client<--server, does not push client-->server

export interface WorkspaceQuery_Request {
    workspace: WorkspaceAddress;
    storageId: StorageId;
    query: Query;
}
export interface WorkspaceQuery_Response {
    workspace: WorkspaceAddress;
    storageId: StorageId;
    serverMaxLocalIndexOverall: number;
    docs: Doc[];
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
    lastSeenAt: number | null; // a timestamp in Earthstar-style microseconds
}
export interface WorkspaceStateFromServer {
    workspace: WorkspaceAddress;
    serverStorageId: StorageId;
    serverMaxLocalIndexOverall: number;
}
export interface WorkspaceState {
    workspace: WorkspaceAddress;
    serverStorageId: StorageId;
    serverMaxLocalIndexOverall: number;
    serverMaxLocalIndexSoFar: number; // -1 if unknown
    clientStorageId: StorageId;
    clientMaxLocalIndexOverall: number;
    clientMaxLocalIndexSoFar: number; // -1 if unknown
    lastSeenAt: number;
}

export let initialPeerClientState: PeerClientState = {
    serverPeerId: null,
    commonWorkspaces: null,
    workspaceStates: {},
    lastSeenAt: null,
};

export interface IPeerClient {
    // Each client only talks to one server.

    // this is async in case we later want to set up
    // a message bus that alerts when the state is changed
    setState(newState: Partial<PeerClientState>): Promise<void>;

    // get and return the server's peerId.
    // this is small and simple and it be used as a ping to check if the server is online.
    do_getServerPeerId(): Promise<PeerId>;

    // figure out workspaces we have in common
    // do_: launches the request, runs handle_, and updates our state with the result
    do_saltyHandshake(): Promise<void>;
    handle_saltyHandshake(
        response: SaltyHandshake_Response,
    ): Promise<Partial<PeerClientState>>;

    // get workspace states from the server (localIndex numbers)
    // do_: launches the request, runs handle_, and updates our state with the result
    do_allWorkspaceStates(): Promise<void>;
    handle_allWorkspaceStates(
        request: AllWorkspaceStates_Request,
        response: AllWorkspaceStates_Response,
    ): Promise<Partial<PeerClientState>>;

    // do a query and ingest the results
    // do_: launches the request, runs process_, returns number of docs obtained that were not invalid
    do_workspaceQuery(request: WorkspaceQuery_Request): Promise<number>;
    process_workspaceQuery(response: WorkspaceQuery_Response): Promise<number>;
}

//--------------------------------------------------

export interface IPeerServer {
    // this does not affect any internal state, in fact
    // the server has no internal state (except maybe for
    // rate limiting, etc)

    // this class will be exposed over RPC --
    // make sure it only has methods that are safe to be exposed to the internet.

    serve_peerId(): Promise<PeerId>;

    serve_saltyHandshake(
        request: SaltyHandshake_Request,
    ): Promise<SaltyHandshake_Response>;
    serve_allWorkspaceStates(
        request: AllWorkspaceStates_Request,
    ): Promise<AllWorkspaceStates_Response>;
    serve_workspaceQuery(
        request: WorkspaceQuery_Request,
    ): Promise<WorkspaceQuery_Response>;
}
