import {
  AuthorKeypair,
  Crypto,
  CryptoDriverSodium,
  Peer,
  Replica,
  setGlobalCryptoDriver,
  ShareKeypair,
} from "../mod.ts";
import { AttachmentDriverMemory } from "../src/replica/attachment_drivers/memory.ts";
import { DocDriverMemory } from "../src/replica/doc_drivers/memory.ts";
import {
  docAttachmentsAreEquivalent,
  docsAreEquivalent,
  writeRandomDocs,
} from "../src/test/test-utils.ts";

const keypair = await Crypto.generateAuthorKeypair("test") as AuthorKeypair;

setGlobalCryptoDriver(CryptoDriverSodium);

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

const makeReplicaTrio = (addr: string, shareSecret: string) => {
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
    new Replica({
      driver: {
        docDriver: new DocDriverMemory(addr),
        attachmentDriver: new AttachmentDriverMemory(),
      },
      shareSecret,
    }),
  ] as [Replica, Replica, Replica];
};

const [a1, a2, a3] = makeReplicaTrio(ADDRESS_A, shareKeypairA.secret);
const [b1, b2, b3] = makeReplicaTrio(ADDRESS_B, shareKeypairB.secret);
const [c1, c2, c3] = makeReplicaTrio(ADDRESS_C, shareKeypairC.secret);

const docCount = 10;

console.log("writing docs");

await Promise.all([
  writeRandomDocs(keypair, a1, docCount),
  writeRandomDocs(keypair, a2, docCount),
  writeRandomDocs(keypair, a3, docCount),

  writeRandomDocs(keypair, b1, docCount),
  writeRandomDocs(keypair, b2, docCount),
  writeRandomDocs(keypair, b3, docCount),

  writeRandomDocs(keypair, c1, docCount),
  writeRandomDocs(keypair, c2, docCount),
  writeRandomDocs(keypair, c3, docCount),
]);

console.log("wrote docs");

const peer1 = new Peer();
const peer2 = new Peer();
const peer3 = new Peer();

peer1.addReplica(a1);
peer1.addReplica(b1);
peer1.addReplica(c1);

peer2.addReplica(a2);
peer2.addReplica(b2);
peer2.addReplica(c2);

peer3.addReplica(a3);
peer3.addReplica(b3);
peer3.addReplica(c3);

const syncer = peer1.sync(peer2, true);
const syncer2 = peer2.sync(peer3, true);
const syncer3 = peer3.sync(peer1, true);

syncer.onStatusChange((status) => {
  // console.log(status);
});

// set up a syncer with a local partner.

// attach all attachments.
console.log("syncing...");

await new Promise((res) => {
  setTimeout(res, docCount * 40);
});

const trios = [[a1, a2, a3], [b1, b2, b3], [c1, c2, c3]];

for (const [x, y, z] of trios) {
  // get all docs.
  const fstDocs = await x.getAllDocs();
  const sndDocs = await y.getAllDocs();
  const thdDocs = await z.getAllDocs();

  const fstWithAttachments = await x.addAttachments(fstDocs);
  const sndWithAttachments = await y.addAttachments(sndDocs);
  const thdWithAttachments = await z.addAttachments(sndDocs);

  console.group(x.share);

  const docsSynced = docsAreEquivalent(fstDocs, sndDocs);
  const docsSynced2 = docsAreEquivalent(sndDocs, thdDocs);

  if (docsSynced && docsSynced2) {
    console.log(`Docs synced!`);
  } else {
    console.log(`%c Docs did not sync...`, "color: red");
  }

  const res = await docAttachmentsAreEquivalent(
    fstWithAttachments,
    sndWithAttachments,
  );

  const res2 = await docAttachmentsAreEquivalent(
    sndWithAttachments,
    thdWithAttachments,
  );

  if (res && res2) {
    console.log(`Attachments synced!`);
  } else {
    console.log(`%c Attachments did not sync...`, "color: red");
  }
  console.groupEnd();
}

console.log("writing docs");

await Promise.all([
  writeRandomDocs(keypair, a1, docCount),
  writeRandomDocs(keypair, a2, docCount),
  writeRandomDocs(keypair, a3, docCount),

  writeRandomDocs(keypair, b1, docCount),
  writeRandomDocs(keypair, b2, docCount),
  writeRandomDocs(keypair, b3, docCount),

  writeRandomDocs(keypair, c1, docCount),
  writeRandomDocs(keypair, c2, docCount),
  writeRandomDocs(keypair, c3, docCount),
]);

console.log("wrote docs (again)");

await new Promise((res) => {
  setTimeout(res, docCount * 40);
});

for (const [x, y, z] of trios) {
  // get all docs.
  const fstDocs = await x.getAllDocs();
  const sndDocs = await y.getAllDocs();
  const thdDocs = await z.getAllDocs();

  const fstWithAttachments = await x.addAttachments(fstDocs);
  const sndWithAttachments = await y.addAttachments(sndDocs);
  const thdWithAttachments = await z.addAttachments(sndDocs);

  console.group(x.share);

  const docsSynced = docsAreEquivalent(fstDocs, sndDocs);
  const docsSynced2 = docsAreEquivalent(sndDocs, thdDocs);

  if (docsSynced && docsSynced2) {
    console.log(`Docs synced!`);
  } else {
    console.log(`%c Docs did not sync...`, "color: red");
  }

  const res = await docAttachmentsAreEquivalent(
    fstWithAttachments,
    sndWithAttachments,
  );

  const res2 = await docAttachmentsAreEquivalent(
    sndWithAttachments,
    thdWithAttachments,
  );

  if (res && res2) {
    console.log(`Attachments synced!`);
  } else {
    console.log(`%c Attachments did not sync...`, "color: red");
  }
  console.groupEnd();
}

await syncer.cancel("1 cancelled");
await syncer2.cancel("2 cancelled");
await syncer3.cancel("3 cancelled");

// Deno.exit(0);
for (const [x, y, z] of trios) {
  await x.close(true);
  await y.close(true);
  await z.close(true);
}

Deno.exit(0);
