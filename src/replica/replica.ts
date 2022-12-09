import { DefaultFormats } from "../formats/format_types.ts";
import { IReplicaDriver, MultiFormatReplicaOpts } from "./replica-types.ts";
import { MultiformatReplica } from "./multiformat_replica.ts";

type ReplicaOpts = {
  /** The secret of the share this replica has been configured to use.
   *
   * If omitted the replica will be read only.
   */
  shareSecret?: string;
  /** A replica driver which will be used to instruct the replica how to read and write data.
   */
  driver: IReplicaDriver;
};

/**
 * A replica holding a share's data, used to read, write, and synchronise data to.
 *
 * Should be closed using the `close` method when no longer being used.
 *
 * ```ts
 * const gardeningKeypair = await Crypto.generateShareKeypair("gardening");
 *
 * const myReplica = new Replica({
 *  driver: new ReplicaDriverMemory(gardeningKeypair.shareAddress),
 *  shareSecret: gardeningKeypair.secret
 * });
 * ```
 */
export class Replica extends MultiformatReplica {
  constructor(opts: ReplicaOpts) {
    super({
      driver: opts.driver,
      config: {
        "es.5": {
          shareSecret: opts.shareSecret,
        },
      },
    } as MultiFormatReplicaOpts<DefaultFormats>);
  }
}
