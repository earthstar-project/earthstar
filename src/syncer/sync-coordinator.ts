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
          pulledCount: 0,
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

    const queryResponse = await this.connection.request(
      "serveShareQuery",
      {
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
      },
    );

    const { lastSeenAt, shareStates, ingested, pulled } = await this.syncerBag
      .processShareQuery(
        this.shareStates,
        queryResponse,
      );

    this.mergeShareStates(shareStates);
    this.partnerLastSeenAt = lastSeenAt;

    const mergedShareState = this.shareStates[shareAddress];

    const syncStatus = this.syncStatuses.get(shareAddress);

    if (!syncStatus) {
      return;
    }

    const nextIsCaughtUp = mergedShareState.partnerMaxLocalIndexSoFar >=
      mergedShareState.partnerMaxLocalIndexOverall;

    if (
      ingested > 0 || pulled > 0 || nextIsCaughtUp !== syncStatus.isCaughtUp
    ) {
      await this.syncStatuses.set(shareAddress, {
        ingestedCount: syncStatus.ingestedCount + ingested,
        pulledCount: syncStatus.pulledCount + pulled,
        isCaughtUp: nextIsCaughtUp,
        partnerIsCaughtUp: syncStatus.partnerIsCaughtUp,
      });
    }

    if ((this.state as "ready" | "active" | "closed") === "closed") {
      return;
    }

    this.connection.notify(
      "notifyCaughtUpChange",
      mergedShareState.storageId,
      nextIsCaughtUp,
    );

    clearTimeout(this.pullTimeouts.get(shareAddress));

    this.pullTimeouts.set(
      shareAddress,
      setTimeout(
        () => {
          this.pull(shareAddress);
        },
        nextIsCaughtUp ? 1000 : 0,
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

  async storageCaughtUp(storageId: string, isCaughtUp: boolean) {
    for (const shareAddress in this.shareStates) {
      const shareState = this.shareStates[shareAddress];
      const syncStatus = this.syncStatuses.get(shareAddress);

      if (shareState.partnerStorageId === storageId && syncStatus) {
        await this.syncStatuses.set(shareState.share, {
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
