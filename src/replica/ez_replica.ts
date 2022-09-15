import { DefaultFormats } from "../formats/format_types.ts";
import { IReplicaDriver, ReplicaOpts } from "./replica-types.ts";
import { Replica } from "./replica.ts";

type EzReplicaOpts = {
  shareSecret?: string;
  driver: IReplicaDriver;
};

export class EzReplica extends Replica {
  constructor(opts: EzReplicaOpts) {
    super({
      driver: opts.driver,
      config: {
        "es.5": {
          shareSecret: opts.shareSecret,
        },
      },
    } as ReplicaOpts<DefaultFormats>);
  }
}
