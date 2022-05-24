import { Replica } from "../../replica/replica.ts";
import { ReplicaDriverMemory } from "../../replica/replica-driver-memory.ts";
import { writeRandomDocs } from "../test-utils.ts";
import { Crypto } from "../../crypto/crypto.ts";
import { AuthorKeypair } from "../../util/doc-types.ts";
import { HaveEntryKeeper } from "../../syncer/have_entry_keeper.ts";

const replica = new Replica({ driver: new ReplicaDriverMemory("+test.a123") });

const keypair = await Crypto.generateAuthorKeypair("test") as AuthorKeypair;

await writeRandomDocs(keypair, replica, 10000);

const amounts = [100, 1000, 10000];

for (const amount of amounts) {
  Deno.bench(`Ready (${amount})`, async () => {
    const stream = replica.getQueryStream({
      historyMode: "all",
      limit: amount,
      orderBy: "localIndex ASC",
    }, "existing");

    const keeper = new HaveEntryKeeper("existing");

    stream.pipeTo(keeper.writable);

    await keeper.isReady();
  });

  // Bench calculating hash.
  const stream = replica.getQueryStream({
    historyMode: "all",
    limit: amount,
    orderBy: "localIndex ASC",
  }, "existing");

  const keeper = new HaveEntryKeeper("existing");

  stream.pipeTo(keeper.writable);

  await keeper.isReady();

  Deno.bench(`getHash (${amount})`, () => {
    keeper.getHash();
  });

  // Bench returning entries.
  Deno.bench(`getEntries (${amount})`, () => {
    keeper.getEntries();
  });
}
