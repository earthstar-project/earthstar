import { Connection } from "../../deps.ts";
import { Peer } from "../peer/peer.ts";
import { makeSyncerBag, SyncerBag } from "./_syncer-bag.ts";
import { WorkspaceAddress } from "../util/doc-types.ts";
import { WorkspaceQueryRequest, WorkspaceState } from "./sync-types.ts";

/** Orchestrates different requests in order to syncrhronise a Peer using a connection */
export class SyncCoordinator {
    _connection: Connection<SyncerBag>;
    _syncerBag: SyncerBag;

    _commonWorkspaces: WorkspaceAddress[] = [];
    _partnerLastSeenAt: number | null = null;
    _partnerPeerId: string | null = null;

    _workspaceStates: Record<WorkspaceAddress, WorkspaceState> = {};

    // TODO: Soon we'll have streams, not polling.
    _pullIntervals: Array<number> = [];

    state: "ready" | "active" | "closed" = "ready";

    constructor(peer: Peer, connection: Connection<SyncerBag>) {
        this._syncerBag = makeSyncerBag(peer);
        this._connection = connection;
    }

    /** Start the coordinator - establish common workspaces and begin pulling
     * @returns - A promise for an initial pull of all workspaces.
     */
    async start() {
        this.state = "active";

        // Perform salty handshake
        const saltedHandshakeRes = await this._connection.request("serveSaltedHandshake");

        const { commonWorkspaces, partnerLastSeenAt, partnerPeerId } = await this._syncerBag
            .processSaltedHandshake(saltedHandshakeRes);

        this._commonWorkspaces = commonWorkspaces;
        this._partnerLastSeenAt = partnerLastSeenAt;
        this._partnerPeerId = partnerPeerId;

        this._connection._otherDeviceId = partnerPeerId;

        // Get the workspace states from the partner
        await this.getWorkspaceStates();

        const initialPulls = [];

        // Use that to set up regular polls
        for (const key in this._workspaceStates) {
            const state = this._workspaceStates[key];

            const pull = () =>
                this.pullDocs({
                    // Eventually we'll do smart stuff with localIndex.
                    // For now just ask for EVERYTHING, EVERY TIME.
                    query: {},
                    storageId: state.partnerStorageId,
                    workspace: state.workspace,
                });

            initialPulls.push(pull());
            const interval = setInterval(pull, 10);
            this._pullIntervals.push(interval);
        }

        return Promise.all(initialPulls);
    }

    async getWorkspaceStates() {
        const workspaceStatesRequest = {
            commonWorkspaces: this._commonWorkspaces,
        };

        const workspaceStatesResponse = await this._connection.request(
            "serveAllWorkspaceStates",
            workspaceStatesRequest,
        );

        const { lastSeenAt, partnerPeerId, workspaceStates } = this._syncerBag
            .processAllWorkspaceStates(
                this._workspaceStates,
                workspaceStatesRequest,
                workspaceStatesResponse,
            );

        this._partnerLastSeenAt = lastSeenAt;
        this._partnerPeerId = partnerPeerId;
        this._workspaceStates = workspaceStates;

        this._connection._otherDeviceId = partnerPeerId;
    }

    async pullDocs(workspaceQuery: WorkspaceQueryRequest): Promise<number> {
        const queryResponse = await this._connection.request("serveWorkspaceQuery", workspaceQuery);

        const { lastSeenAt, workspaceStates, pulled } = await this._syncerBag.processWorkspaceQuery(
            this._workspaceStates,
            queryResponse,
        );

        this._workspaceStates = workspaceStates;
        this._partnerLastSeenAt = lastSeenAt;

        return pulled;
    }

    close() {
        for (const interval of this._pullIntervals) {
            clearInterval(interval);
        }

        this.state = "closed";
    }
}
