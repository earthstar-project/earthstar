// Make a test helper.

import { Crypto } from "../../crypto/crypto.ts";
import { Peer } from "../../peer/peer.ts";
import { Replica } from "../../replica/replica.ts";

import { AuthorKeypair } from "../../util/doc-types.ts";
import { sleep } from "../../util/misc.ts";
import { assert } from "../asserts.ts";
import { storagesAreSynced, writeRandomDocs } from "../test-utils.ts";

import {
  ItemType,
  MultiplyOutput,
  multiplyScenarios,
  replicaDrivers,
  syncerDrivers,
  SyncerDriverScenario,
} from "../benchmark/scenarios.ts";
import { IReplicaDriver } from "../../replica/replica-types.ts";

class SyncerTestHelper {
  private scenario: SyncerDriverScenario;
  private aDuo: [Replica, Replica];
  private bDuo: [Replica, Replica];
  private cDuo: [Replica, Replica];

  constructor(
    scenario: SyncerDriverScenario,
    makeReplicaDriver: (addr: string, variant?: string) => IReplicaDriver,
  ) {
    this.scenario = scenario;

    const ADDRESS_A = "+apples.a123";
    const ADDRESS_B = "+bananas.b234";
    const ADDRESS_C = "+coconuts.c345";

    const makeReplicaDuo = (addr: string) => {
      return [
        new Replica({ driver: makeReplicaDriver(addr, "sync-a") }),
        new Replica({ driver: makeReplicaDriver(addr, "sync-b") }),
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

    await Promise.all(allStorages.map((replica) => {
      return writeRandomDocs(keypairA, replica, 10);
    }));

    const [a1, a2] = this.aDuo;
    const [b1, b2] = this.bDuo;
    const [c1] = this.cDuo;

    peerA.addReplica(a1);
    peerA.addReplica(b1);
    peerA.addReplica(c1);
    peerB.addReplica(a2);
    peerB.addReplica(b2);

    const [syncerA, syncerB] = await this.scenario.setup(peerA, peerB);

    return Promise.all([syncerA.isDone, syncerB.isDone]);
  }

  async commonSharesInSync() {
    assert(await storagesAreSynced(this.aDuo));
    assert(await storagesAreSynced(this.bDuo));
    assert(await storagesAreSynced(this.cDuo) === false);
  }

  testAbort() {}

  async teardown() {
    this.scenario.teardown();

    const allStorages = [
      ...this.aDuo,
      ...this.bDuo,
      ...this.cDuo,
    ];

    await Promise.all(allStorages.map((replica) => replica.close(true)));
  }
}
// Check that replicas are synced at the end.

const scenarios: MultiplyOutput<{
  "replicaDriver": ItemType<typeof replicaDrivers>;
  "syncerDriver": ItemType<typeof syncerDrivers>;
}> = multiplyScenarios({
  description: "replicaDriver",
  scenarios: replicaDrivers,
}, {
  description: "syncerDriver",
  scenarios: syncerDrivers,
});

for (const scenario of scenarios) {
  Deno.test(`Syncer (${scenario.name})`, async () => {
    const helper = new SyncerTestHelper(
      scenario.subscenarios.syncerDriver(),
      scenario.subscenarios.replicaDriver,
    );

    await helper.setup();
    await helper.commonSharesInSync();
    await helper.teardown();

    // Have to do this to let the web scenario finish tearing down
    // For some reason this sleep can't be moved into the scenario.teardown itself.
    await sleep(10);
  });
}
