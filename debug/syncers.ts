import { AuthorKeypair, Crypto, Peer, Replica } from "../mod.ts";
import { AttachmentDriverMemory } from "../src/replica/attachment_drivers/memory.ts";
import { DocDriverMemory } from "../src/replica/doc_drivers/memory.ts";
import {
  docAttachmentsAreEquivalent,
  writeRandomDocs,
} from "../src/test/test-utils.ts";

const keypair = await Crypto.generateAuthorKeypair("test") as AuthorKeypair;

// create three replicas x 2.
const ADDRESS_A = "+apples.a123";
const ADDRESS_B = "+bananas.b234";
const ADDRESS_C = "+coconuts.c345";

const makeReplicaDuo = (addr: string) => {
  return [
    new Replica({
      driver: {
        docDriver: new DocDriverMemory(addr),
        attachmentDriver: new AttachmentDriverMemory(),
      },
    }),
    new Replica({
      driver: {
        docDriver: new DocDriverMemory(addr),
        attachmentDriver: new AttachmentDriverMemory(),
      },
    }),
  ] as [Replica, Replica];
};

const [a1, a2] = makeReplicaDuo(ADDRESS_A);
const [b1, b2] = makeReplicaDuo(ADDRESS_B);
const [c1, c2] = makeReplicaDuo(ADDRESS_C);

await writeRandomDocs(keypair, a1, 100);
await writeRandomDocs(keypair, a2, 100);
await writeRandomDocs(keypair, b1, 100);
await writeRandomDocs(keypair, b2, 100);
await writeRandomDocs(keypair, c1, 100);
await writeRandomDocs(keypair, c2, 100);

const peer1 = new Peer();
const peer2 = new Peer();

peer1.addReplica(a1);
peer1.addReplica(b1);
peer1.addReplica(c1);

peer2.addReplica(a2);
peer2.addReplica(b2);
peer2.addReplica(c2);

const syncer = peer1.sync(peer2, false);

// set up a syncer with a local partner.

// attach all attachments.
console.log("syncing...");

await syncer.isDone;

console.log("...done.");

const pairs = [[a1, a2], [b1, b2], [c1, c2]];

for (const [x, y] of pairs) {
  // get all docs.
  const fstDocs = await x.getAllDocs();
  const sndDocs = await y.getAllDocs();

  const fstWithAttachments = await a1.attachAttachments(fstDocs);
  const sndWithAttachments = await a2.attachAttachments(sndDocs);

  console.group(x.share);

  const res = await docAttachmentsAreEquivalent(fstWithAttachments, sndWithAttachments);

  if (res) {
    console.log(`Attachments synced!`);
  } else {
    console.log(`Attachments did not sync...`);
  }
  console.groupEnd();
}
