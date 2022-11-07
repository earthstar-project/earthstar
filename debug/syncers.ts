import { AuthorKeypair, Crypto, Peer, Replica, ShareKeypair } from "../mod.ts";
import { AttachmentDriverMemory } from "../src/replica/attachment_drivers/memory.ts";
import { DocDriverMemory } from "../src/replica/doc_drivers/memory.ts";
import {
  docAttachmentsAreEquivalent,
  docsAreEquivalent,
  writeRandomDocs,
} from "../src/test/test-utils.ts";

const keypair = await Crypto.generateAuthorKeypair("test") as AuthorKeypair;

// create three replicas x 2.
const shareKeypairA = await Crypto.generateShareKeypair(
  "apples",
) as ShareKeypair;
const shareKeypairB = await Crypto.generateShareKeypair(
  "bananas",
) as ShareKeypair;
const shareKeypairC = await Crypto.generateShareKeypair(
  "coconuts",
) as ShareKeypair;

const ADDRESS_A = shareKeypairA.shareAddress;
const ADDRESS_B = shareKeypairB.shareAddress;
const ADDRESS_C = shareKeypairC.shareAddress;

const makeReplicaDuo = (addr: string, shareSecret: string) => {
  return [
    new Replica({
      driver: {
        docDriver: new DocDriverMemory(addr),
        attachmentDriver: new AttachmentDriverMemory(),
      },
      shareSecret,
    }),
    new Replica({
      driver: {
        docDriver: new DocDriverMemory(addr),
        attachmentDriver: new AttachmentDriverMemory(),
      },
      shareSecret,
    }),
  ] as [Replica, Replica];
};

const [a1, a2] = makeReplicaDuo(ADDRESS_A, shareKeypairA.secret);
const [b1, b2] = makeReplicaDuo(ADDRESS_B, shareKeypairB.secret);
const [c1, c2] = makeReplicaDuo(ADDRESS_C, shareKeypairC.secret);

await writeRandomDocs(keypair, a1, 6);
await writeRandomDocs(keypair, a2, 6);
await writeRandomDocs(keypair, b1, 10);
await writeRandomDocs(keypair, b2, 10);
await writeRandomDocs(keypair, c1, 10);
await writeRandomDocs(keypair, c2, 10);

const peer1 = new Peer();
const peer2 = new Peer();

peer1.addReplica(a1);
//peer1.addReplica(b1);
//peer1.addReplica(c1);

peer2.addReplica(a2);
//peer2.addReplica(b2);
//peer2.addReplica(c2);

const syncer = peer1.sync(peer2, false);

// set up a syncer with a local partner.

// attach all attachments.
console.log("syncing...");

await syncer.isDone();

console.log("...done.");

const pairs = [[a1, a2], [b1, b2], [c1, c2]];

for (const [x, y] of pairs) {
  // get all docs.
  const fstDocs = await x.getAllDocs();
  const sndDocs = await y.getAllDocs();

  const fstWithAttachments = await a1.addAttachments(fstDocs);
  const sndWithAttachments = await a2.addAttachments(sndDocs);

  console.log(fstDocs.length, sndDocs.length);

  console.group(x.share);

  const docsSynced = docsAreEquivalent(fstDocs, sndDocs);

  if (docsSynced) {
    console.log(`Docs synced!`);
  } else {
    console.log(`Docs did not sync...`);
  }

  const res = await docAttachmentsAreEquivalent(
    fstWithAttachments,
    sndWithAttachments,
  );

  if (res) {
    console.log(`Attachments synced!`);
  } else {
    console.log(`Attachments did not sync...`);
  }
  console.groupEnd();
}
