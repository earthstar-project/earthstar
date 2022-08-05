import { CryptoDriverNoble } from "../../crypto/crypto-driver-noble.ts";
import { ICryptoDriver } from "../../crypto/crypto-types.ts";
import { FormatsArg } from "../../formats/format_types.ts";
import { IPeer } from "../../peer/peer-types.ts";
import { AttachmentDriverMemory } from "../../replica/attachment_drivers/memory.ts";
import { DocDriverMemory } from "../../replica/doc_drivers/memory.ts";
import { PartnerLocal } from "../../syncer/partner_local.ts";
import { Syncer } from "../../syncer/syncer.ts";
import {
  AttachmentDriverScenario,
  DocDriverScenario,
  PartnerScenario,
  Scenario,
} from "./types.ts";

export const universalCryptoDrivers: Scenario<ICryptoDriver>[] = [{
  name: "Noble",
  item: CryptoDriverNoble,
}];

export const universalReplicaDocDrivers: Scenario<DocDriverScenario>[] = [
  {
    name: "Memory",
    item: {
      persistent: false,
      builtInConfigKeys: [],
      makeDriver: (addr) => new DocDriverMemory(addr),
    },
  },
];

export const universalReplicaAttachmentDrivers: Scenario<
  AttachmentDriverScenario
>[] = [
  {
    name: "Memory",
    item: { makeDriver: () => new AttachmentDriverMemory(), persistent: false },
  },
];

export class PartnerScenarioLocal<F> implements PartnerScenario<F> {
  formats: FormatsArg<F>;

  constructor(formats: FormatsArg<F>) {
    this.formats = formats;
  }

  setup(peerA: IPeer, peerB: IPeer) {
    const partner = new PartnerLocal(peerB, peerA, "once", this.formats);

    const syncerA = new Syncer({
      peer: peerA,
      partner,
      mode: "once",
      formats: this.formats,
    });

    return Promise.resolve(
      [syncerA, partner.partnerSyncer] as [Syncer<any, F>, Syncer<any, F>],
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
