import { Rpc } from "../../deps.ts";
import { Peer } from "../peer/peer.ts";
import { makeSyncerBag, SyncerBag } from "./_syncer-bag.ts";
import { WorkspaceAddress } from "../util/doc-types.ts";
import { WorkspaceQueryRequest, WorkspaceState } from "./syncer-types.ts";

/** Orchestrates different requests in order to syncrhronise a Peer using a connection */
export class SyncCoordinator {
    _connection: Rpc.IConnection<SyncerBag>;
    _syncerBag: SyncerBag;
    _workspaceStates: Record<WorkspaceAddress, WorkspaceState> = {};
    // TODO: Soon we'll have streams, not polling.
    _pullIntervals: Map<string, number> = new Map();

    commonWorkspaces: WorkspaceAddress[] = [];
    partnerLastSeenAt: number | null = null;

    state: "ready" | "active" | "closed" = "ready";

    constructor(peer: Peer, connection: Rpc.IConnection<SyncerBag>) {
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

        const { commonWorkspaces, partnerLastSeenAt } = await this._syncerBag
            .processSaltedHandshake(saltedHandshakeRes);

        this.commonWorkspaces = commonWorkspaces;
        this.partnerLastSeenAt = partnerLastSeenAt;

        // Get the workspace states from the partner
        await this._getWorkspaceStates();

        const initialPulls = [];

        // Use that to set up regular polls
        for (const key in this._workspaceStates) {
            const pull = () => {
                const state = this._workspaceStates[key];

                this._pullDocs({
                    // Eventually we'll do smart stuff with localIndex.
                    // For now just ask for EVERYTHING, EVERY TIME.
                    query: {
                        orderBy: "localIndex ASC",
                        startAfter: {
                            localIndex: state.partnerMaxLocalIndexSoFar,
                        },
                    },
                    storageId: state.partnerStorageId,
                    workspace: state.workspace,
                });
            };

            initialPulls.push(pull());

            const interval = setInterval(pull, 1000);
            this._pullIntervals.set(key, interval);
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

        const { lastSeenAt, workspaceStates } = this._syncerBag
            .processAllWorkspaceStates(
                this._workspaceStates,
                workspaceStatesRequest,
                workspaceStatesResponse,
            );

        this.partnerLastSeenAt = lastSeenAt;

        this._workspaceStates = workspaceStates;
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
        this._pullIntervals.forEach((interval) => {
            clearInterval(interval);
        });

        this.state = "closed";
    }
}
