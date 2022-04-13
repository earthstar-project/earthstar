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
  private peerReplicaMapUnsub: () => void;
  private pullTimeouts: Map<string, number> = new Map();

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

    for (const address in this.shareStates) {
      this.pull(address);
    }
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
          partnerIsCaughtUp: false,
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

  async pull(shareAddress: string) {
    const state = this.shareStates[shareAddress];

    if (this.state === "closed" || !state) {
      console.error(
        `%c Could not find ${shareAddress} in share states...`,
        "background-color: red;",
      );
      return;
    }

    const isCaughtUp = await new Promise<boolean>((resolve) => {
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
        const syncStatus = this.syncStatuses.get(result.shareState.share);

        if (!syncStatus) {
          return;
        }

        const nextIsCaughtUp = state.partnerMaxLocalIndexSoFar >=
          result.shareState.partnerMaxLocalIndexOverall;

        if (result.ingested > 0 || nextIsCaughtUp !== syncStatus.isCaughtUp) {
          this.syncStatuses.set(result.shareState.share, {
            ingestedCount: syncStatus.ingestedCount + result.ingested,
            isCaughtUp: nextIsCaughtUp,
            partnerIsCaughtUp: syncStatus.partnerIsCaughtUp,
          });
        }

        if (nextIsCaughtUp !== syncStatus.isCaughtUp) {
          this.connection.notify(
            "notifyCaughtUpChange",
            result.shareState.storageId,
            nextIsCaughtUp,
          );
        }

        resolve(nextIsCaughtUp);
      });
    });

    if ((this.state as "ready" | "active" | "closed") === "closed") {
      return;
    }

    clearTimeout(this.pullTimeouts.get(shareAddress));

    this.pullTimeouts.set(
      shareAddress,
      setTimeout(
        () => {
          this.pull(shareAddress);
        },
        isCaughtUp ? 1000 : 100,
      ),
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

    const prevShares = Object.keys(this.shareStates);
    const nextShares = Object.keys(shareStates);

    this.shareStates = shareStates;

    // Start / end pulls for new / deleted shares, respectively.
    for (const nextShare in shareStates) {
      if (!prevShares.includes(nextShare)) {
        this.pull(nextShare);
      }
    }

    for (const oldShare of prevShares) {
      if (!nextShares.includes(oldShare)) {
        this.pullTimeouts.delete(oldShare);
      }
    }
  }

  private async pullDocs(
    shareQuery: ShareQueryRequest,
  ): Promise<
    { pulled: number; ingested: number; shareState: ShareState }
  > {
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

    return {
      pulled,
      ingested,
      shareState: shareStates[shareQuery.share],
    };
  }

  private mergeShareStates(newShareStates: Record<string, ShareState>) {
    const nextShareStates: Record<string, ShareState> = {};

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
        ),
        partnerMaxLocalIndexOverall: newShareState.partnerMaxLocalIndexOverall,
        partnerMaxLocalIndexSoFar: newShareState.partnerMaxLocalIndexSoFar,
      };
    }

    this.shareStates = nextShareStates;
  }

  storageCaughtUp(storageId: string, isCaughtUp: boolean) {
    for (const shareAddress in this.shareStates) {
      const shareState = this.shareStates[shareAddress];
      const syncStatus = this.syncStatuses.get(shareAddress);

      if (shareState.partnerStorageId === storageId && syncStatus) {
        this.syncStatuses.set(shareState.share, {
          ...syncStatus,
          partnerIsCaughtUp: isCaughtUp,
        });
      }
    }
  }

  close() {
    this.pullTimeouts.forEach((timeout) => clearTimeout(timeout));

    this.peerReplicaMapUnsub();

    this.state = "closed";
  }
}
