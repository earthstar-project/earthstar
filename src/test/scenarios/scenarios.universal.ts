import { CryptoDriverNoble } from "../../crypto/crypto-driver-noble.ts";
import { ICryptoDriver } from "../../crypto/crypto-types.ts";
import { FormatsArg } from "../../formats/format_types.ts";
import { IPeer } from "../../peer/peer-types.ts";
import { AttachmentDriverMemory } from "../../replica/attachment_drivers/memory.ts";
import { DocDriverMemory } from "../../replica/doc_drivers/memory.ts";
import { PartnerLocal } from "../../syncer/partner_local.ts";

import { SyncAppetite } from "../../syncer/syncer_types.ts";
import {
  AttachmentDriverScenario,
  DocDriverScenario,
  Scenario,
  SyncDriverScenario,
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

export class SyncScenarioLocal<F> implements SyncDriverScenario<F> {
  formats: FormatsArg<F>;
  appetite: SyncAppetite;

  constructor(formats: FormatsArg<F>, appetite: SyncAppetite) {
    this.formats = formats;
    this.appetite = appetite;
  }

  setup(peerA: IPeer, peerB: IPeer) {
    const partner = new PartnerLocal(peerB, peerA, this.appetite, this.formats);

    const syncerA = peerA.addSyncPartner(partner);

    return Promise.resolve(
      [syncerA.isDone(), partner.partnerSyncer.isDone()] as [
        Promise<void>,
        Promise<void>,
      ],
    );
  }

  teardown() {
    return Promise.resolve();
  }
}

export const universalPartners: Scenario<
  <F>(formats: FormatsArg<F>, appetite: SyncAppetite) => SyncDriverScenario<F>
>[] = [{
  name: "Local",
  item: (formats, appetite) => new SyncScenarioLocal(formats, appetite),
}];
