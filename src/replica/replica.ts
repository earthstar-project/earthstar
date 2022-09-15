import { DefaultFormats } from "../formats/format_types.ts";
import { IReplicaDriver, MultiFormatReplicaOpts } from "./replica-types.ts";
import { MultiformatReplica } from "./multiformat_replica.ts";

type ReplicaOpts = {
  shareSecret?: string;
  driver: IReplicaDriver;
};

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
