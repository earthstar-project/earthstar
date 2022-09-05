// Make a test helper.

import { Crypto } from "../../crypto/crypto.ts";
import { Peer } from "../../peer/peer.ts";
import { Replica } from "../../replica/replica.ts";

import { AuthorKeypair } from "../../util/doc-types.ts";
import { sleep } from "../../util/misc.ts";
import { assert } from "../asserts.ts";
import {
  storagesAreSynced,
  storagesAttachmentsAreSynced,
  writeRandomDocs,
} from "../test-utils.ts";
import { isNode } from "https://deno.land/x/which_runtime@0.2.0/mod.ts";

import {
  docDriverScenarios,
  partnerScenarios,
} from "../scenarios/scenarios.ts";
import { IReplicaDocDriver } from "../../replica/replica-types.ts";
import {
  MultiplyScenarioOutput,
  PartnerScenario,
  ScenarioItem,
} from "../scenarios/types.ts";
import { multiplyScenarios } from "../scenarios/utils.ts";

import { AttachmentDriverMemory } from "../../replica/attachment_drivers/memory.ts";
import { FormatEs5 } from "../../formats/format_es5.ts";
import { isErr } from "../../util/errors.ts";

class SyncerTestHelper {
  private scenario: PartnerScenario<[typeof FormatEs5]>;
  private aDuo: [Replica, Replica];
  private bDuo: [Replica, Replica];
  private cDuo: [Replica, Replica];

  constructor(
    scenario: PartnerScenario<[typeof FormatEs5]>,
    makeDocDriver: (addr: string, variant?: string) => IReplicaDocDriver,
  ) {
    this.scenario = scenario;

    const ADDRESS_A = "+apples.a123";
    const ADDRESS_B = "+bananas.b234";
    const ADDRESS_C = "+coconuts.c345";

    const makeReplicaDuo = (addr: string) => {
      return [
        new Replica({
          driver: {
            docDriver: makeDocDriver(addr, "sync-a"),
            attachmentDriver: new AttachmentDriverMemory(),
          },
        }),
        new Replica({
          driver: {
            docDriver: makeDocDriver(addr, "sync-b"),
            attachmentDriver: new AttachmentDriverMemory(),
          },
        }),
      ] as [Replica, Replica];
    };

    this.aDuo = makeReplicaDuo(ADDRESS_A);
    this.bDuo = makeReplicaDuo(ADDRESS_B);
    this.cDuo = makeReplicaDuo(ADDRESS_C);
  }

  async setup() {
    const peerA = new Peer();
    const peerB = new Peer();

    const keypairA = await Crypto.generateAuthorKeypair(
      "suzy",
    ) as AuthorKeypair;

    const allStorages = [
      ...this.aDuo,
      ...this.bDuo,
      ...this.cDuo,
    ];

    const writes = await Promise.all(allStorages.map((replica) => {
      return writeRandomDocs(keypairA, replica, 10);
    }));

    assert(
      writes.every((replicaWrites) => {
        return replicaWrites.every((write) => isErr(write) === false);
      }),
      "Test docs were written successfully to replicas",
    );

    const [a1, a2] = this.aDuo;
    const [b1, b2] = this.bDuo;
    const [c1] = this.cDuo;

    peerA.addReplica(a1);
    peerA.addReplica(b1);
    peerA.addReplica(c1);
    peerB.addReplica(a2);
    peerB.addReplica(b2);

    const [syncerA, syncerB] = await this.scenario.setup(peerA, peerB);

    return Promise.all([syncerA.isDone(), syncerB.isDone()]);
  }

  async commonSharesInSync() {
    // Without this, tests for the Node distribution fail for some reason.
    if (isNode) {
      await sleep(5);
    }

    const docCounts = [];

    for (const r of [...this.aDuo, ...this.bDuo]) {
      const docs = await r.getAllDocs();
      docCounts.push(docs.length);
    }

    assert(
      docCounts.every((count) => count === 20),
      "all replicas have the right number of docs",
    );

    assert(await storagesAreSynced(this.aDuo), `+a docs are in sync`);
    assert(await storagesAreSynced(this.bDuo), `+b docs are in sync`);
    assert(
      await storagesAreSynced(this.cDuo) === false,
      `+c docs are not in sync`,
    );

    assert(
      await storagesAttachmentsAreSynced(this.aDuo),
      `+a attachments are in sync`,
    );
    assert(
      await storagesAttachmentsAreSynced(this.bDuo),
      `+b attachments are in sync`,
    );
    assert(
      await storagesAttachmentsAreSynced(this.cDuo) === false,
      `+c attachments are not in sync`,
    );
  }

  testAbort() {}

  async teardown() {
    await this.scenario.teardown();

    const allStorages = [
      ...this.aDuo,
      ...this.bDuo,
      ...this.cDuo,
    ];

    await Promise.all(allStorages.map((replica) => replica.close(true)));
  }
}
// Check that replicas are synced at the end.

const scenarios: MultiplyScenarioOutput<{
  "replicaDriver": ScenarioItem<typeof docDriverScenarios>;
  "partner": ScenarioItem<typeof partnerScenarios>;
}> = multiplyScenarios({
  description: "replicaDriver",
  scenarios: docDriverScenarios,
}, {
  description: "partner",
  scenarios: partnerScenarios,
});

for (const scenario of scenarios) {
  Deno.test(`Syncer (${scenario.name})`, async (test) => {
    const helper = new SyncerTestHelper(
      scenario.subscenarios.partner([FormatEs5]),
      scenario.subscenarios.replicaDriver.makeDriver,
    );

    await helper.setup();

    await test.step({
      name: "is in sync",
      fn: () => helper.commonSharesInSync(),
      sanitizeOps: false,
      sanitizeResources: false,
    });

    await helper.teardown();

    // Have to do this to let the web scenario finish tearing down
    // For some reason this sleep can't be moved into the scenario.teardown itself.
    await sleep(15);
  });
}
