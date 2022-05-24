import { CryptoDriverNoble } from "../../crypto/crypto-driver-noble.ts";
import { ICryptoDriver } from "../../crypto/crypto-types.ts";
import { IPeer } from "../../peer/peer-types.ts";
import { ReplicaDriverMemory } from "../../replica/replica-driver-memory.ts";
import { PartnerLocal } from "../../syncer/partner_local.ts";
import { Syncer } from "../../syncer/syncer.ts";
import { PartnerScenario, ReplicaScenario, Scenario } from "./types.ts";

export const universalCryptoDrivers: Scenario<ICryptoDriver>[] = [{
  name: "Noble",
  item: CryptoDriverNoble,
}];

export const universalReplicaDrivers: Scenario<ReplicaScenario>[] = [
  {
    name: "Memory",
    item: {
      persistent: false,
      builtInConfigKeys: [],
      makeDriver: (addr) => new ReplicaDriverMemory(addr),
    },
  },
];

export class PartnerScenarioLocal implements PartnerScenario {
  setup(peerA: IPeer, peerB: IPeer) {
    const partner = new PartnerLocal(peerB, "once");

    const syncerA = new Syncer({
      peer: peerA,
      partner,
      mode: "once",
    });

    return Promise.resolve(
      [syncerA, partner.partnerSyncer] as [Syncer, Syncer],
    );
  }

  teardown() {
    return Promise.resolve();
  }
}

export const universalPartners: Scenario<() => PartnerScenario>[] = [{
  name: "Local",
  item: () => new PartnerScenarioLocal(),
}];
