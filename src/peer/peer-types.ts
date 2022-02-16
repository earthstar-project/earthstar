import { ShareAddress } from "../util/doc-types.ts";
import { IReplica } from "../replica/replica-types.ts";

//================================================================================
// PEER

export type PeerId = string;

/** Holds many shares' replicas and manages their synchronisation with other peers. Recommended as the point of contact between your application and Earthstar shares. */
export interface IPeer {
    // TODO: oops, or should we have storage IDs instead of peer IDs?
    peerId: PeerId;

    // getters
    hasShare(share: ShareAddress): boolean;
    shares(): ShareAddress[];
    replicas(): IReplica[];
    size(): number;
    getReplica(share: ShareAddress): IReplica | undefined;

    // setters
    addReplica(replica: IReplica): Promise<void>;
    removeReplicaByShare(share: ShareAddress): Promise<void>;
    removeReplica(replica: IReplica): Promise<void>;

    sync(
        target: IPeer | string,
    ): () => void;

    stopSyncing(): void;
}
