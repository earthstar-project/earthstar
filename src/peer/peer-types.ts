import { ShareAddress } from "../util/doc-types.ts";
import { IReplica } from "../replica/replica-types.ts";
import { Syncer } from "../syncer/syncer.ts";

//================================================================================
// PEER

export type PeerId = string;

/** Holds many shares' replicas and manages their synchronisation with other peers. Recommended as the point of contact between your application and Earthstar shares. */
export interface IPeer {
  // getters
  hasShare(share: ShareAddress): boolean;
  shares(): ShareAddress[];
  replicas(): IReplica[];
  size(): number;
  getReplica(
    share: ShareAddress,
  ): IReplica | undefined;

  // setters
  addReplica(replica: IReplica): Promise<void>;
  removeReplicaByShare(share: ShareAddress): Promise<void>;
  removeReplica(replica: IReplica): Promise<void>;

  sync(
    target: IPeer | string,
    live?: boolean,
  ): Syncer;

  onReplicasChange(
    callback: (map: Map<ShareAddress, IReplica>) => void | Promise<void>,
  ): () => void;
}
