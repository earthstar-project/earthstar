import { deferred } from "../deps.ts";
import {
  AttachmentDriverMemory,
  AuthorKeypair,
  Crypto,
  CryptoDriverSodium,
  DocDriverMemory,
  Peer,
  Replica,
  setGlobalCryptoDriver,
  ShareKeypair,
} from "../mod.ts";
import { LANSession } from "../src/discovery/discovery_lan.ts";
import { TcpProvider } from "../src/discovery/tcp_provider.ts";
import { writeRandomDocs } from "../src/test/test-utils.ts";

const keypair = await Crypto.generateAuthorKeypair("test") as AuthorKeypair;

setGlobalCryptoDriver(CryptoDriverSodium);

const shareKeypair = await Crypto.generateShareKeypair(
  "apples",
) as ShareKeypair;

const replicaA = new Replica({
  driver: {
    docDriver: new DocDriverMemory(shareKeypair.shareAddress),
    attachmentDriver: new AttachmentDriverMemory(),
  },
  shareSecret: shareKeypair.secret,
});

const replicaB = new Replica({
  driver: {
    docDriver: new DocDriverMemory(shareKeypair.shareAddress),
    attachmentDriver: new AttachmentDriverMemory(),
  },
  shareSecret: shareKeypair.secret,
});

await writeRandomDocs(keypair, replicaA, 1000);
await writeRandomDocs(keypair, replicaB, 1000);

const peerA = new Peer();
const peerB = new Peer();

peerA.addReplica(replicaA);
peerB.addReplica(replicaB);

const lanSessionA = deferred<LANSession>();
const lanSessionB = deferred<LANSession>();

const tcpProvider = new TcpProvider();

// Set up listeners...
const listenerA = tcpProvider.listen({ port: 17171 });
const listenerB = tcpProvider.listen({ port: 17172 });

(async () => {
  for await (const conn of listenerA) {
    const session = await lanSessionA;

    await session.addConn(conn);
  }
})();

(async () => {
  for await (const conn of listenerB) {
    const session = await lanSessionB;

    await session.addConn(conn);
  }
})();

console.log("Started syncing...");

lanSessionA.resolve(
  new LANSession(false, peerA, "once", {
    hostname: "127.0.0.1",
    port: 17172,
    name: "Peer B",
  }),
);

lanSessionB.resolve(
  new LANSession(true, peerB, "once", {
    hostname: "127.0.0.1",
    port: 17171,
    name: "Peer A",
  }),
);

const syncerA = await (await lanSessionA).syncer;
const syncerB = await (await lanSessionB).syncer;

await Promise.all([syncerA.isDone(), syncerB.isDone()]);

console.log("Synced");

listenerA.close();
listenerB.close();

replicaA.close(false);
replicaB.close(false);
