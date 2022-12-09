import { FormatsArg, IFormat } from "../../formats/format_types.ts";
import { IPeer } from "../../peer/peer-types.ts";
import {
  IReplicaAttachmentDriver,
  IReplicaDocDriver,
} from "../../replica/replica-types.ts";
import { IServerExtension } from "../../server/extensions/extension.ts";
import { Syncer } from "../../syncer/syncer.ts";
import { SyncAppetite } from "../../syncer/syncer_types.ts";
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

export type MultiplyScenarioOutput<RecordType extends Record<string, unknown>> =
  {
    name: string;
    subscenarios: RecordType;
  }[];

export interface SyncPartnerScenario<F> {
  formats: FormatsArg<F>;
  appetite: SyncAppetite;
  setup(
    peerA: IPeer,
    peerB: IPeer,
  ): Promise<[Syncer<unknown, F>, Syncer<unknown, F>]>;
  teardown(): Promise<void>;
}

export interface ServerScenario {
  start(testExtension: IServerExtension): Promise<void>;
  close(): Promise<void>;
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
  C extends Record<string, unknown>,
  F extends IFormat<N, I, O, C>,
> = {
  format: F;
  makeInputDoc: () => I;
};
