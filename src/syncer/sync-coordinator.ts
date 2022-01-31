import { Connection, IConnection } from "../../deps.ts";
import { Peer } from "../peer/peer.ts";
import { makeSyncerBag, SyncerBag } from "./_syncer-bag.ts";
import { WorkspaceAddress } from "../util/doc-types.ts";
import { WorkspaceQueryRequest, WorkspaceState } from "./sync-types.ts";

/** Orchestrates different requests in order to syncrhronise a Peer using a connection */
export class SyncCoordinator {
    _connection: IConnection<SyncerBag>;
    _syncerBag: SyncerBag;
    _workspaceStates: Record<WorkspaceAddress, WorkspaceState> = {};
    // TODO: Soon we'll have streams, not polling.
    _pullIntervals: Array<number> = [];

    commonWorkspaces: WorkspaceAddress[] = [];
    partnerLastSeenAt: number | null = null;
    partnerPeerId: string | null = null;

    state: "ready" | "active" | "closed" = "ready";

    constructor(peer: Peer, connection: IConnection<SyncerBag>) {
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

        this.commonWorkspaces = commonWorkspaces;
        this.partnerLastSeenAt = partnerLastSeenAt;
        this.partnerPeerId = partnerPeerId;

        this._connection._otherDeviceId = partnerPeerId;

        // Get the workspace states from the partner
        await this._getWorkspaceStates();

        const initialPulls = [];

        // Use that to set up regular polls
        for (const key in this._workspaceStates) {
            const state = this._workspaceStates[key];

            const pull = () =>
                this._pullDocs({
                    // Eventually we'll do smart stuff with localIndex.
                    // For now just ask for EVERYTHING, EVERY TIME.
                    query: {},
                    storageId: state.partnerStorageId,
                    workspace: state.workspace,
                });

            initialPulls.push(pull());
            const interval = setInterval(pull, 5000);
            this._pullIntervals.push(interval);
        }

        this._connection.onClose(() => {
            this.close();
        });

        return Promise.all(initialPulls);
    }

    async _getWorkspaceStates() {
        const workspaceStatesRequest = {
            commonWorkspaces: this.commonWorkspaces,
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

        this.partnerLastSeenAt = lastSeenAt;
        this.partnerPeerId = partnerPeerId;
        this._workspaceStates = workspaceStates;

        this._connection._otherDeviceId = partnerPeerId;
    }

    async _pullDocs(workspaceQuery: WorkspaceQueryRequest): Promise<number> {
        const queryResponse = await this._connection.request("serveWorkspaceQuery", workspaceQuery);

        const { lastSeenAt, workspaceStates, pulled } = await this._syncerBag.processWorkspaceQuery(
            this._workspaceStates,
            queryResponse,
        );

        this._workspaceStates = workspaceStates;
        this.partnerLastSeenAt = lastSeenAt;

        return pulled;
    }

    close() {
        for (const interval of this._pullIntervals) {
            clearInterval(interval);
        }

        this.state = "closed";
    }
}
