import {
  DocBase,
  DocInputBase,
  FormatName,
  ShareAddress,
} from "../util/doc-types.ts";
import { IReplica, ReplicaForValidator } from "../replica/replica-types.ts";
import { SyncSessionStatus } from "../syncer/syncer-types.ts";
import { IFormatValidator } from "../format-validators/format-validator-types.ts";

//================================================================================
// PEER

export type PeerId = string;

/** Holds many shares' replicas and manages their synchronisation with other peers. Recommended as the point of contact between your application and Earthstar shares. */
export interface IPeer<
  FormatType extends FormatName,
  DocInputType extends DocInputBase<FormatType>,
  DocType extends DocBase<FormatType>,
  ValidatorType extends IFormatValidator<
    FormatType,
    DocInputType,
    DocType
  >,
> {
  // TODO: oops, or should we have storage IDs instead of peer IDs?
  peerId: PeerId;

  // getters
  hasShare(share: ShareAddress): boolean;
  shares(): ShareAddress[];
  replicas(): ReplicaForValidator<ValidatorType>[];
  size(): number;
  getReplica(
    share: ShareAddress,
  ): ReplicaForValidator<ValidatorType> | undefined;

  // setters
  addReplica(replica: ReplicaForValidator<FormatType>): Promise<void>;
  removeReplicaByShare(share: ShareAddress): Promise<void>;
  removeReplica(replica: ReplicaForValidator<FormatType>): Promise<void>;

  sync(
    target: IPeer<FormatType, DocInputType, DocType, ValidatorType> | string,
  ): () => void;

  stopSyncing(): void;

  syncUntilCaughtUp(
    targets:
      (IPeer<FormatType, DocInputType, DocType, ValidatorType> | string)[],
  ): Promise<Record<string, Record<ShareAddress, SyncSessionStatus>>>;
}

export type PeerForValidator<ValidatorType> = ValidatorType extends
  IFormatValidator<
    infer FormatType,
    infer DocInputType,
    infer DocType
  > ? IPeer<FormatType, DocInputType, DocType, ValidatorType>
  : never;
