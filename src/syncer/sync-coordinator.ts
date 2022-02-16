import { type IConnection } from "../../deps.ts";
import { Peer } from "../peer/peer.ts";
import { makeSyncerBag, SyncerBag } from "./_syncer-bag.ts";
import { ShareAddress } from "../util/doc-types.ts";
import { ShareQueryRequest, ShareState } from "./syncer-types.ts";

/** Orchestrates different requests in order to syncrhronise a Peer using a connection */
export class SyncCoordinator {
    _connection: IConnection<SyncerBag>;
    _syncerBag: SyncerBag;
    _shareStates: Record<ShareAddress, ShareState> = {};
    _interval: number | null = null;

    commonShares: ShareAddress[] = [];
    partnerLastSeenAt: number | null = null;

    state: "ready" | "active" | "closed" = "ready";

    constructor(peer: Peer, connection: IConnection<SyncerBag>) {
        this._syncerBag = makeSyncerBag(peer);
        this._connection = connection;
    }

    /** Start the coordinator - establish common shares and begin pulling
     * @returns - A promise for an initial pull of all shares.
     */
    async start() {
        this.state = "active";

        // Perform salty handshake

        const saltedHandshakeRes = await this._connection.request("serveSaltedHandshake");

        const { commonShares, partnerLastSeenAt } = await this._syncerBag
            .processSaltedHandshake(saltedHandshakeRes);

        this.commonShares = commonShares;
        this.partnerLastSeenAt = partnerLastSeenAt;

        // Get the share states from the partner

        const pull = async () => {
            await this._getShareStates();

            Object.keys(this._shareStates).forEach((key) => {
                const state = this._shareStates[key];

                this._pullDocs({
                    query: {
                        orderBy: "localIndex ASC",
                        startAfter: {
                            localIndex: state.partnerMaxLocalIndexSoFar,
                        },
                    },
                    storageId: state.partnerStorageId,
                    share: state.share,
                });
            });
        };

        this._interval = setInterval(pull, 1000);

        this._connection.onClose(() => {
            this.close();
        });

        await pull();
    }

    async _getShareStates() {
        const shareStatesRequest = {
            commonShares: this.commonShares,
        };

        const shareStatesResponse = await this._connection.request(
            "serveAllShareStates",
            shareStatesRequest,
        );

        const { lastSeenAt, shareStates } = this._syncerBag
            .processAllShareStates(
                this._shareStates,
                shareStatesRequest,
                shareStatesResponse,
            );

        this.partnerLastSeenAt = lastSeenAt;

        this._shareStates = shareStates;
    }

    async _pullDocs(shareQuery: ShareQueryRequest): Promise<number> {
        const queryResponse = await this._connection.request("serveShareQuery", shareQuery);

        const { lastSeenAt, shareStates, pulled } = await this._syncerBag.processShareQuery(
            this._shareStates,
            queryResponse,
        );

        this._shareStates = shareStates;
        this.partnerLastSeenAt = lastSeenAt;

        return pulled;
    }

    close() {
        if (this._interval) {
            clearTimeout(this._interval);
        }

        this.state = "closed";
    }
}
