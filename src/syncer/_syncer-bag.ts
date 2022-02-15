import { Peer } from "../peer/peer.ts";
import { microsecondNow, randomId } from "../util/misc.ts";
import { Doc, WorkspaceAddress } from "../util/doc-types.ts";
import { Crypto } from "../crypto/crypto.ts";
import { sortedInPlace } from "../storage/compare.ts";
import { ValidationError } from "../util/errors.ts";
import {
    AllWorkspaceStatesRequest,
    AllWorkspaceStatesResponse,
    SaltedHandshakeResponse,
    SaltedHandshakeResult,
    WorkspaceQueryRequest,
    WorkspaceQueryResponse,
    WorkspaceQueryResult,
    WorkspaceState,
    WorkspaceStateFromResponse,
} from "./syncer-types.ts";

function saltAndHashWorkspace(
    salt: string,
    workspace: WorkspaceAddress,
): Promise<string> {
    return Crypto.sha256base32(salt + workspace + salt);
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
            const saltedWorkspaces = await Promise.all(
                peer.workspaces().map((ws) => saltAndHashWorkspace(salt, ws)),
            );

            return {
                peerId: peer.peerId,
                salt,
                saltedWorkspaces,
            };
        },

        /** Process a salted handshake response */
        async processSaltedHandshake(
            response: SaltedHandshakeResponse,
        ): Promise<SaltedHandshakeResult> {
            const { peerId, salt, saltedWorkspaces } = response;

            const serverSaltedSet = new Set<string>(saltedWorkspaces);
            const commonWorkspaceSet = new Set<WorkspaceAddress>();
            for (const plainWs of peer.workspaces()) {
                const saltedWs = await saltAndHashWorkspace(salt, plainWs);
                if (serverSaltedSet.has(saltedWs)) {
                    commonWorkspaceSet.add(plainWs);
                }
            }
            const commonWorkspaces = sortedInPlace([...commonWorkspaceSet]);

            return {
                partnerPeerId: peerId,
                partnerLastSeenAt: microsecondNow(),
                commonWorkspaces: commonWorkspaces,
            };
        },

        // -----------------------------------------
        // WORKSPACE STATES

        serveAllWorkspaceStates(
            request: AllWorkspaceStatesRequest,
        ): AllWorkspaceStatesResponse {
            const workspaceStates: Record<
                WorkspaceAddress,
                WorkspaceStateFromResponse
            > = {};
            for (const workspace of request.commonWorkspaces) {
                const storage = peer.getStorage(workspace);
                if (storage === undefined) {
                    continue;
                }
                const workspaceState: WorkspaceStateFromResponse = {
                    workspace: workspace,
                    partnerStorageId: storage.storageId,
                    partnerMaxLocalIndexOverall: storage.getMaxLocalIndex(),
                };
                workspaceStates[workspace] = workspaceState;
            }

            return {
                partnerPeerId: peer.peerId,
                workspaceStates,
            };
        },

        processAllWorkspaceStates(
            existingWorkspaceStates: Record<WorkspaceAddress, WorkspaceState>,
            request: AllWorkspaceStatesRequest,
            response: AllWorkspaceStatesResponse,
        ) {
            // request is provided here so we can check for consistency in case the server replied with
            // something totally different

            const { commonWorkspaces } = request;
            const { partnerPeerId, workspaceStates } = response;

            const newWorkspaceStates: Record<WorkspaceAddress, WorkspaceState> = {};
            for (const workspace of Object.keys(workspaceStates)) {
                const workspaceStateFromServer = workspaceStates[workspace];
                if (workspaceStateFromServer.workspace !== workspace) {
                    throw new ValidationError(
                        `server shenanigans: server response is not self-consistent, workspace key does not match data in the Record ${workspaceStateFromServer.workspace} & ${workspace}`,
                    );
                }
                if (commonWorkspaces.indexOf(workspace) === -1) {
                    throw new ValidationError(
                        `server shenanigans: server included a workspace that is not common: ${workspace}`,
                    );
                }
                const clientStorage = peer.getStorage(workspace);
                if (clientStorage === undefined) {
                    throw new ValidationError(
                        `server shenanigans: referenced a workspace we don't have: ${workspace}`,
                    );
                }

                const existingWorkspaceState = existingWorkspaceStates[workspace] || {};
                newWorkspaceStates[workspace] = {
                    workspace,

                    partnerStorageId: workspaceStateFromServer.partnerStorageId,
                    partnerMaxLocalIndexOverall:
                        workspaceStateFromServer.partnerMaxLocalIndexOverall,
                    // set maxIndexSoFar to -1 if it's missing, otherwise preserve the old value
                    partnerMaxLocalIndexSoFar: existingWorkspaceState.partnerMaxLocalIndexSoFar ??
                        -1,

                    // TODO: check if client storage id has changed, and if so reset this state

                    storageId: clientStorage.storageId,
                    maxLocalIndexOverall: clientStorage.getMaxLocalIndex(),
                    // set maxIndexSoFar to -1 if it's missing, otherwise preserve the old value
                    maxLocalIndexSoFar: existingWorkspaceState.maxLocalIndexSoFar ?? -1,

                    lastSeenAt: microsecondNow(),
                };
            }

            return {
                partnerPeerId,
                // TODO: should this merge with, or overwrite, the existing one?
                // we've incorporated the existing one into this one already, so we should
                // have checked if the serverPeerId has changed also...
                workspaceStates: newWorkspaceStates,
                lastSeenAt: microsecondNow(),
            };
        },

        // -----------------------------------------
        // QUERYING

        /** Respond to a query */
        async serveWorkspaceQuery(request: WorkspaceQueryRequest): Promise<WorkspaceQueryResponse> {
            const { workspace, storageId, query } = request;

            const storage = peer.getStorage(workspace);
            if (storage === undefined) {
                const err = `workspace ${workspace} is unknown; skipping`;
                throw err;
            }
            if (storage.storageId !== storageId) {
                const err =
                    `storageId for ${workspace} is not ${storageId} anymore, it's ${storage.storageId}`;
                throw err;
            }

            const docs: Doc[] = await storage.queryDocs(query);

            return {
                workspace,
                storageId,
                partnerMaxLocalIndexOverall: storage.getMaxLocalIndex(),
                docs,
            };
        },

        /** Process a query response */
        async processWorkspaceQuery(
            existingWorkspaceStates: Record<WorkspaceAddress, WorkspaceState>,
            response: WorkspaceQueryResponse,
        ): Promise<WorkspaceQueryResult> {
            // returns the number of docs pulled, even if they were obsolete or we alreayd had them.

            const {
                workspace,
                storageId,
                partnerMaxLocalIndexOverall,
                docs,
            } = response;
            // TODO: we need to compare this with the request to make sure
            // the server didn't switch the workspace or storageId on us...
            // maybe that can happen in do_...

            // get the storage
            const storage = peer.getStorage(workspace);
            if (storage === undefined) {
                const err = `workspace ${workspace} is unknown; skipping`;

                throw err;
            }

            const myWorkspaceState = existingWorkspaceStates[workspace];
            if (storageId !== myWorkspaceState.partnerStorageId) {
                const err =
                    `storageId for ${workspace} is not ${storageId} anymore, it's ${myWorkspaceState.partnerStorageId}`;

                throw err;
            }

            // ingest the docs
            let pulled = 0;
            for (const doc of docs) {
                // get the workspace every time in case something else is changing it?
                let myWorkspaceState = existingWorkspaceStates[workspace];
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
                myWorkspaceState = {
                    ...myWorkspaceState,
                    partnerMaxLocalIndexOverall,
                    partnerMaxLocalIndexSoFar: doc._localIndex ?? -1,
                    lastSeenAt: microsecondNow(),
                };
            }

            return {
                pulled,
                lastSeenAt: microsecondNow(),
                workspaceStates: {
                    ...existingWorkspaceStates,
                    [workspace]: myWorkspaceState,
                },
            };
        },
    };
}

export type SyncerBag = ReturnType<typeof makeSyncerBag>;
