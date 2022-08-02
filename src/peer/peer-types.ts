import { ShareAddress } from "../util/doc-types.ts";
import { Replica } from "../replica/replica.ts";
import { FormatsArg } from "../formats/default.ts";
import { Syncer } from "../syncer/syncer.ts";

//================================================================================
// PEER

export type PeerId = string;

/** Holds many shares' replicas and manages their synchronisation with other peers. Recommended as the point of contact between your application and Earthstar shares. */
export interface IPeer {
  // getters
  hasShare(share: ShareAddress): boolean;
  shares(): ShareAddress[];
  replicas(): Replica[];
  size(): number;
  getReplica(
    share: ShareAddress,
  ): Replica | undefined;

  // setters
  addReplica(replica: Replica): Promise<void>;
  removeReplicaByShare(share: ShareAddress): Promise<void>;
  removeReplica(replica: Replica): Promise<void>;

  sync<F>(
    target: IPeer | string,
    live?: boolean,
    formats?: FormatsArg<F>,
  ): Syncer<undefined, F>;

  onReplicasChange(
    callback: (map: Map<ShareAddress, Replica>) => void | Promise<void>,
  ): () => void;
}
