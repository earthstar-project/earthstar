import { CryptoDriverNoble } from "../../crypto/crypto-driver-noble.ts";
import { ICryptoDriver } from "../../crypto/crypto-types.ts";
import { FormatsArg } from "../../formats/default.ts";
import { IPeer } from "../../peer/peer-types.ts";
import { DocDriverMemory } from "../../replica/doc_drivers/memory.ts";
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
      makeDriver: (addr) => ({
        docDriver: new DocDriverMemory(addr),
        blobDriver: null,
      }),
    },
  },
];

export class PartnerScenarioLocal<F> implements PartnerScenario<F> {
  formats: FormatsArg<F>;

  constructor(formats: FormatsArg<F>) {
    this.formats = formats;
  }

  setup(peerA: IPeer, peerB: IPeer) {
    const partner = new PartnerLocal(peerB, "once", this.formats);

    const syncerA = new Syncer({
      peer: peerA,
      partner,
      mode: "once",
      formats: this.formats,
    });

    return Promise.resolve(
      [syncerA, partner.partnerSyncer] as [Syncer<F>, Syncer<F>],
    );
  }

  teardown() {
    return Promise.resolve();
  }
}

export const universalPartners: Scenario<
  <F>(formats: FormatsArg<F>) => PartnerScenario<F>
>[] = [{
  name: "Local",
  item: (formats) => new PartnerScenarioLocal(formats),
}];
