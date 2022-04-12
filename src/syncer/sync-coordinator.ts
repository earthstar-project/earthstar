import { type IConnection, SuperbusMap } from "../../deps.ts";
import { Peer } from "../peer/peer.ts";
import { makeSyncerBag, SyncerBag } from "./_syncer-bag.ts";
import { ShareAddress } from "../util/doc-types.ts";
import {
  ShareQueryRequest,
  ShareState,
  SyncSessionStatus,
} from "./syncer-types.ts";

/** Orchestrates different requests in order to syncrhronise a Peer using a connection */
export class SyncCoordinator {
  private connection: IConnection<SyncerBag>;
  private syncerBag: SyncerBag;
  private shareStates: Record<ShareAddress, ShareState> = {};
  private timeout: number | null = null;
  private peerReplicaMapUnsub: () => void;

  /** A subscribable map of shares and the status of their synchronisation operations. */
  syncStatuses: SuperbusMap<ShareAddress, SyncSessionStatus> =
    new SuperbusMap();

  partnerLastSeenAt: number | null = null;
  state: "ready" | "active" | "closed" = "ready";

  /** The shares which this SyncCoordinator has in common with the peer at the other end of the connection. */
  get commonShares() {
    return Array.from(this.syncStatuses.keys());
  }

  constructor(peer: Peer, connection: IConnection<SyncerBag>) {
    this.syncerBag = makeSyncerBag(peer);
    this.connection = connection;

    this.peerReplicaMapUnsub = peer.replicaMap.bus.on("*", () => {
      this.performSaltedHandshake().then(() => {
        this.getShareStates();
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

    await this.getShareStates();
    await this.pull();
  }

  async performSaltedHandshake() {
    // Perform salted handshake

    const saltedHandshakeRes = await this.connection.request(
      "serveSaltedHandshake",
    );

    const { commonShares, partnerLastSeenAt } = await this.syncerBag
      .processSaltedHandshake(saltedHandshakeRes);

    // Add a new sync status entry for each share
    for (const share of commonShares) {
      if (!this.syncStatuses.has(share)) {
        await this.syncStatuses.set(share, {
          ingestedCount: 0,
          isCaughtUp: false,
        });
      }
    }

    // Make sure to remove any status entries for shares no longer in common
    for (const shareAddress in this.syncStatuses) {
      if (!commonShares.includes(shareAddress)) {
        await this.syncStatuses.delete(shareAddress);
      }
    }

    this.partnerLastSeenAt = partnerLastSeenAt;
  }

  async pull() {
    if (this.state === "closed") {
      return;
    }

    const docPulls = Object.keys(this.shareStates).map((key) => {
      return new Promise<boolean>((resolve) => {
        const state = this.shareStates[key];

        this.pullDocs({
          query: {
            historyMode: "all",
            orderBy: "localIndex ASC",
            startAfter: {
              localIndex: state.partnerMaxLocalIndexSoFar,
            },
            limit: 10,
          },
          storageId: state.partnerStorageId,
          share: state.share,
        }).then((result) => {
          const syncStatus = this.syncStatuses.get(result.share);

          if (!syncStatus) {
            return;
          }

          let nextIsCaughtUp = syncStatus.isCaughtUp;

          if (result.pulled === 0 && syncStatus.isCaughtUp === false) {
            nextIsCaughtUp = true;
          }

          if (result.pulled > 0 && syncStatus.isCaughtUp === true) {
            nextIsCaughtUp = false;
          }

          this.syncStatuses.set(result.share, {
            ingestedCount: syncStatus.ingestedCount + result.ingested,
            isCaughtUp: nextIsCaughtUp,
          });

          resolve(nextIsCaughtUp);
        });
      });
    });

    const pullResults = await Promise.all(docPulls);

    this.timeout = setTimeout(
      () => this.pull(),
      pullResults.every((res) => res) ? 1000 : 0,
    );
  }

  private async getShareStates() {
    const shareStatesRequest = {
      commonShares: Array.from(this.syncStatuses.keys()),
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

  private async pullDocs(
    shareQuery: ShareQueryRequest,
  ): Promise<{ pulled: number; ingested: number; share: string }> {
    const queryResponse = await this.connection.request(
      "serveShareQuery",
      shareQuery,
    );

    const { lastSeenAt, shareStates, pulled, ingested } = await this.syncerBag
      .processShareQuery(
        this.shareStates,
        queryResponse,
      );

    this.mergeShareStates(shareStates);
    this.partnerLastSeenAt = lastSeenAt;

    return { pulled, ingested, share: shareQuery.share };
  }

  private mergeShareStates(newShareStates: Record<string, ShareState>) {
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
