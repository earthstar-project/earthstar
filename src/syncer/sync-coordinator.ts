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
    _timeout: number | null = null;

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

        this._connection.onClose(() => {
            this.close();
        });

        await this.pull();
    }

    async pull() {
        if (this.state === "closed") {
            return;
        }

        await this._getShareStates();

        const docPulls = Object.keys(this._shareStates).map((key) => {
            return new Promise((resolve) => {
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
                }).then(resolve);
            });
        });

        await Promise.all(docPulls);

        this._timeout = setTimeout(() => this.pull(), 1000);
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

        this._mergeShareStates(shareStates);
        this.partnerLastSeenAt = lastSeenAt;

        return pulled;
    }

    _mergeShareStates(newShareStates: Record<string, ShareState>) {
        const nextShareStates: Record<string, ShareState> = {};

        // Because pulls can happen asynchronously, they may return a lower partnerMaxLocalIndexOverall / soFar than the one saved in the coordinator's state.
        // We want to make sure the higher value is returned every time, so that we don't repeatedly refetch documents from the same low localIndex.
        for (const shareAddress in newShareStates) {
            const newShareState = newShareStates[shareAddress];
            const existingShareState = this._shareStates[shareAddress];

            if (!existingShareState) {
                nextShareStates[shareAddress] = newShareState;
                break;
            }

            nextShareStates[shareAddress] = {
                ...newShareState,
                lastSeenAt: Math.max(newShareState.lastSeenAt, existingShareState.lastSeenAt),
                partnerMaxLocalIndexOverall: Math.max(
                    newShareState.partnerMaxLocalIndexOverall,
                    existingShareState.partnerMaxLocalIndexOverall,
                ),
                partnerMaxLocalIndexSoFar: Math.max(
                    newShareState.partnerMaxLocalIndexSoFar,
                    existingShareState.partnerMaxLocalIndexSoFar,
                ),
            };
        }

        this._shareStates = nextShareStates;
    }

    close() {
        if (this._timeout) {
            clearTimeout(this._timeout);
        }

        this.state = "closed";
    }
}
