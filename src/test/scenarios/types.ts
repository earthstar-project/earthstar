import { IPeer } from "../../peer/peer-types.ts";
import { IReplicaDriver } from "../../replica/replica-types.ts";
import { Syncer } from "../../syncer/syncer.ts";
import { ShareAddress } from "../../util/doc-types.ts";

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

export interface PartnerScenario {
  setup(peerA: IPeer, peerB: IPeer): Promise<[Syncer, Syncer]>;
  teardown(): Promise<void>;
}

export type ReplicaScenario = {
  makeDriver: (share: ShareAddress, variant?: string) => IReplicaDriver;
  persistent: boolean;
  builtInConfigKeys: string[];
};
