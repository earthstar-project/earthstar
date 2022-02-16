import { Peer } from "../peer/peer.ts";
import { microsecondNow, randomId } from "../util/misc.ts";
import { Doc, ShareAddress } from "../util/doc-types.ts";
import { Crypto } from "../crypto/crypto.ts";
import { sortedInPlace } from "../replica/compare.ts";
import { ValidationError } from "../util/errors.ts";
import {
    AllShareStatesRequest,
    AllShareStatesResponse,
    SaltedHandshakeResponse,
    SaltedHandshakeResult,
    ShareQueryRequest,
    ShareQueryResponse,
    ShareQueryResult,
    ShareState,
    ShareStateFromResponse,
} from "./syncer-types.ts";

function saltAndHashShare(
    salt: string,
    share: ShareAddress,
): Promise<string> {
    return Crypto.sha256base32(salt + share + salt);
}

/** Produce a bag of syncing methods to pass to earthstar-streaming-rpc. */
// Contains both client and server methods.
export function makeSyncerBag(peer: Peer) {
    return {
        // -----------------------------------------
        // SALTED HANDSHAKE

        /** Serve a request for a salted handshake*/
        async serveSaltedHandshake() {
            const salt = randomId();
            const saltedShares = await Promise.all(
                peer.shares().map((ws) => saltAndHashShare(salt, ws)),
            );

            return {
                peerId: peer.peerId,
                salt,
                saltedShares,
            };
        },

        /** Process a salted handshake response */
        async processSaltedHandshake(
            response: SaltedHandshakeResponse,
        ): Promise<SaltedHandshakeResult> {
            const { peerId, salt, saltedShares } = response;

            const serverSaltedSet = new Set<string>(saltedShares);
            const commonShareSet = new Set<ShareAddress>();
            for (const plainWs of peer.shares()) {
                const saltedWs = await saltAndHashShare(salt, plainWs);
                if (serverSaltedSet.has(saltedWs)) {
                    commonShareSet.add(plainWs);
                }
            }
            const commonShares = sortedInPlace([...commonShareSet]);

            return {
                partnerPeerId: peerId,
                partnerLastSeenAt: microsecondNow(),
                commonShares,
            };
        },

        // -----------------------------------------
        // Share STATES

        serveAllShareStates(
            request: AllShareStatesRequest,
        ): AllShareStatesResponse {
            const shareStates: Record<
                ShareAddress,
                ShareStateFromResponse
            > = {};
            for (const share of request.commonShares) {
                const storage = peer.getReplica(share);
                if (storage === undefined) {
                    continue;
                }
                const shareState: ShareStateFromResponse = {
                    share,
                    partnerStorageId: storage.replicaId,
                    partnerMaxLocalIndexOverall: storage.getMaxLocalIndex(),
                };
                shareStates[share] = shareState;
            }

            return {
                partnerPeerId: peer.peerId,
                shareStates,
            };
        },

        processAllShareStates(
            existingShareStates: Record<ShareAddress, ShareState>,
            request: AllShareStatesRequest,
            response: AllShareStatesResponse,
        ) {
            // request is provided here so we can check for consistency in case the server replied with
            // something totally different

            const { commonShares } = request;
            const { partnerPeerId, shareStates } = response;

            const newShareStates: Record<ShareAddress, ShareState> = {};
            for (const share of Object.keys(shareStates)) {
                const shareStateFromServer = shareStates[share];
                if (shareStateFromServer.share !== share) {
                    throw new ValidationError(
                        `server shenanigans: server response is not self-consistent, share key does not match data in the Record ${shareStateFromServer.share} & ${share}`,
                    );
                }
                if (commonShares.indexOf(share) === -1) {
                    throw new ValidationError(
                        `server shenanigans: server included a share that is not common: ${share}`,
                    );
                }
                const clientStorage = peer.getReplica(share);
                if (clientStorage === undefined) {
                    throw new ValidationError(
                        `server shenanigans: referenced a share we don't have: ${share}`,
                    );
                }

                const existingShareState = existingShareStates[share] || {};
                newShareStates[share] = {
                    share,

                    partnerStorageId: shareStateFromServer.partnerStorageId,
                    partnerMaxLocalIndexOverall: shareStateFromServer.partnerMaxLocalIndexOverall,
                    // set maxIndexSoFar to -1 if it's missing, otherwise preserve the old value
                    partnerMaxLocalIndexSoFar: existingShareState.partnerMaxLocalIndexSoFar ??
                        -1,

                    // TODO: check if client storage id has changed, and if so reset this state

                    storageId: clientStorage.replicaId,
                    maxLocalIndexOverall: clientStorage.getMaxLocalIndex(),
                    // set maxIndexSoFar to -1 if it's missing, otherwise preserve the old value
                    maxLocalIndexSoFar: existingShareState.maxLocalIndexSoFar ?? -1,

                    lastSeenAt: microsecondNow(),
                };
            }

            return {
                partnerPeerId,
                // TODO: should this merge with, or overwrite, the existing one?
                // we've incorporated the existing one into this one already, so we should
                // have checked if the serverPeerId has changed also...
                shareStates: newShareStates,
                lastSeenAt: microsecondNow(),
            };
        },

        // -----------------------------------------
        // QUERYING

        /** Respond to a query */
        async serveShareQuery(request: ShareQueryRequest): Promise<ShareQueryResponse> {
            const { share, storageId, query } = request;

            const replica = peer.getReplica(share);
            if (replica === undefined) {
                const err = `share ${share} is unknown; skipping`;
                throw err;
            }
            if (replica.replicaId !== storageId) {
                const err =
                    `storageId for ${share} is not ${storageId} anymore, it's ${replica.replicaId}`;
                throw err;
            }

            const docs: Doc[] = await replica.queryDocs(query);

            return {
                share,
                storageId,
                partnerMaxLocalIndexOverall: replica.getMaxLocalIndex(),
                docs,
            };
        },

        /** Process a query response */
        async processShareQuery(
            existingShareStates: Record<ShareAddress, ShareState>,
            response: ShareQueryResponse,
        ): Promise<ShareQueryResult> {
            // returns the number of docs pulled, even if they were obsolete or we alreayd had them.

            const {
                share,
                storageId,
                partnerMaxLocalIndexOverall,
                docs,
            } = response;
            // TODO: we need to compare this with the request to make sure
            // the server didn't switch the share or storageId on us...
            // maybe that can happen in do_...

            // get the storage
            const storage = peer.getReplica(share);
            if (storage === undefined) {
                const err = `share ${share} is unknown; skipping`;

                throw err;
            }

            const myShareState = existingShareStates[share];
            if (storageId !== myShareState.partnerStorageId) {
                const err =
                    `storageId for ${share} is not ${storageId} anymore, it's ${myShareState.partnerStorageId}`;

                throw err;
            }

            // ingest the docs
            let pulled = 0;
            for (const doc of docs) {
                // get the share every time in case something else is changing it?
                let myShareState = existingShareStates[share];
                // TODO: keep checking if storageId has changed every time

                // save the doc
                const ingestEvent = await storage.ingest(doc);
                if (ingestEvent.kind === "failure") {
                    // TODO: big problem:
                    // If the server gives a doc from the future, it will be invalid
                    // so we can't ingest it.  We will need to get it in a future
                    // query so we can ingest it then.
                    // So what do we do with our record of the server's maxIndexSoFar?
                    // I think we have to abort here and try continuing later,
                    // otherwise we'll leave a gap and that doc-from-the-future
                    // will never get synced.
                    // BUT this means a single invalid doc can block syncing forever.
                    // We need to know if it's invalid because it's from the future,
                    // in which case we should stop and try later, or if it's
                    // invalid for another reason, in which case we should ignore it
                    // and continue.
                    break;
                }
                pulled += 1;
                myShareState = {
                    ...myShareState,
                    partnerMaxLocalIndexOverall,
                    partnerMaxLocalIndexSoFar: doc._localIndex ?? -1,
                    lastSeenAt: microsecondNow(),
                };
            }

            return {
                pulled,
                lastSeenAt: microsecondNow(),
                shareStates: {
                    ...existingShareStates,
                    [share]: myShareState,
                },
            };
        },
    };
}

export type SyncerBag = ReturnType<typeof makeSyncerBag>;
