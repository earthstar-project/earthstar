import { FormatsArg } from "../../formats/util.ts";
import { IFormat } from "../../formats/format_types.ts";
import { IPeer } from "../../peer/peer-types.ts";
import {
  IReplicaAttachmentDriver,
  IReplicaDocDriver,
  IReplicaDriver,
} from "../../replica/replica-types.ts";
import { Syncer } from "../../syncer/syncer.ts";
import {
  DocBase,
  DocInputBase,
  FormatName,
  ShareAddress,
} from "../../util/doc-types.ts";

export type Scenario<T> = {
  name: string;
  item: T;
};

export type ScenarioItem<T> = T extends Scenario<infer ItemType>[] ? ItemType
  : never;

export type Scenarios<DescType extends string, ScenarioType> = {
  description: DescType;
  scenarios: Scenario<ScenarioType>[];
};

export type MultiplyScenarioOutput<RecordType extends Record<string, any>> = {
  name: string;
  subscenarios: RecordType;
}[];

export interface PartnerScenario<F> {
  formats: FormatsArg<F>;

  setup(
    peerA: IPeer,
    peerB: IPeer,
  ): Promise<[Syncer<any, F>, Syncer<any, F>]>;
  teardown(): Promise<void>;
}

export type DocDriverScenario = {
  makeDriver: (share: ShareAddress, variant?: string) => IReplicaDocDriver;
  persistent: boolean;
  builtInConfigKeys: string[];
};

export type AttachmentDriverScenario = {
  makeDriver: (shareAddr: string, variant?: string) => IReplicaAttachmentDriver;
  persistent: boolean;
};

export type FormatScenario<
  N extends FormatName,
  I extends DocInputBase<N>,
  O extends DocBase<N>,
  F extends IFormat<N, I, O>,
> = {
  format: F;
  makeInputDoc: () => I;
};
