import { type IConnection } from "../../deps.ts";
import { Peer } from "../peer/peer.ts";
import { makeSyncerBag, SyncerBag } from "./_syncer-bag.ts";
import { ShareAddress } from "../util/doc-types.ts";
import { ShareQueryRequest, ShareState } from "./syncer-types.ts";

/** Orchestrates different requests in order to syncrhronise a Peer using a connection */
export class SyncCoordinator {
  private connection: IConnection<SyncerBag>;
  private syncerBag: SyncerBag;
  private shareStates: Record<ShareAddress, ShareState> = {};
  private timeout: number | null = null;
  private peerReplicaMapUnsub: () => void;

  commonShares: ShareAddress[] = [];
  partnerLastSeenAt: number | null = null;
  state: "ready" | "active" | "closed" = "ready";

  constructor(peer: Peer, connection: IConnection<SyncerBag>) {
    this.syncerBag = makeSyncerBag(peer);
    this.connection = connection;

    this.peerReplicaMapUnsub = peer.replicaMap.bus.on("*", () => {
      this.performSaltedHandshake().then(() => {
        this._getShareStates();
      });
    });
  }

  /** Start the coordinator - establish common shares and begin pulling
   * @returns - A promise for an initial pull of all shares.
   */
  async start() {
    this.state = "active";

    await this.performSaltedHandshake();

    // Get the share states from the partner

    this.connection.onClose(() => {
      this.close();
    });

    await this._getShareStates();
    await this.pull();
  }

  async performSaltedHandshake() {
    // Perform salted handshake

    const saltedHandshakeRes = await this.connection.request(
      "serveSaltedHandshake",
    );

    const { commonShares, partnerLastSeenAt } = await this.syncerBag
      .processSaltedHandshake(saltedHandshakeRes);

    this.commonShares = commonShares;
    this.partnerLastSeenAt = partnerLastSeenAt;
  }

  async pull() {
    if (this.state === "closed") {
      return;
    }

    const docPulls = Object.keys(this.shareStates).map((key) => {
      return new Promise((resolve) => {
        const state = this.shareStates[key];

        this._pullDocs({
          query: {
            historyMode: "all",
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

    this.timeout = setTimeout(() => this.pull(), 1000);
  }

  async _getShareStates() {
    const shareStatesRequest = {
      commonShares: this.commonShares,
    };

    const shareStatesResponse = await this.connection.request(
      "serveAllShareStates",
      shareStatesRequest,
    );

    const { lastSeenAt, shareStates } = this.syncerBag
      .processAllShareStates(
        this.shareStates,
        shareStatesRequest,
        shareStatesResponse,
      );

    this.partnerLastSeenAt = lastSeenAt;

    this.shareStates = shareStates;
  }

  async _pullDocs(shareQuery: ShareQueryRequest): Promise<number> {
    const queryResponse = await this.connection.request(
      "serveShareQuery",
      shareQuery,
    );

    const { lastSeenAt, shareStates, pulled } = await this.syncerBag
      .processShareQuery(
        this.shareStates,
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
      const existingShareState = this.shareStates[shareAddress];

      if (!existingShareState) {
        nextShareStates[shareAddress] = newShareState;
        break;
      }

      nextShareStates[shareAddress] = {
        ...newShareState,
        lastSeenAt: Math.max(
          newShareState.lastSeenAt,
          existingShareState.lastSeenAt,
        ),
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

    this.shareStates = nextShareStates;
  }

  close() {
    if (this.timeout) {
      clearTimeout(this.timeout);
    }

    this.peerReplicaMapUnsub();

    this.state = "closed";
  }
}
