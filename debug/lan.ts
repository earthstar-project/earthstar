import {
  AttachmentDriverMemory,
  AuthorKeypair,
  Crypto,
  CryptoDriverSodium,
  DocDriverMemory,
  Peer,
  Replica,
  setGlobalCryptoDriver,
  Syncer,
} from "../mod.ts";
import { DiscoveryLAN } from "../src/lan/discovery_lan.ts";
import { writeRandomDocs } from "../src/test/test-utils.ts";

const keypair = await Crypto.generateAuthorKeypair("test") as AuthorKeypair;

setGlobalCryptoDriver(CryptoDriverSodium);

const shareKeypair = {
  shareAddress:
    "+landisco.blvfxy5iv4mpkiq37pag5ol65hzwx3vwnz7ksedwepb66zff6lqjq",
  secret: "bev6ybcxxjwdcn337ctj4rv5nwqi54xsavqoeo3zbxay7whe3r64q",
};

const replicaA = new Replica({
  driver: {
    docDriver: new DocDriverMemory(shareKeypair.shareAddress),
    attachmentDriver: new AttachmentDriverMemory(),
  },
  shareSecret: shareKeypair.secret,
});

await writeRandomDocs(keypair, replicaA, 100);

const peer = new Peer();

peer.addReplica(replicaA);

const disco = new DiscoveryLAN({
  name: "LAN Peer",
});

console.log("Discovering...");

for await (const event of peer.discover(disco)) {
  switch (event.kind) {
    case "PEER_DISCOVERED": {
      try {
        const syncer = await event.sync();

        console.log(`Discovered ${event.description}`);

        logSyncer(syncer, event.description);
      } catch {
        // already had a session active
      }

      break;
    }
    case "PEER_INITIATED_SYNC": {
      console.log(`Was discovered by ${event.description}`);

      logSyncer(event.syncer, event.description);
    }
  }
}

function logSyncer(syncer: Syncer<unknown, unknown>, description: string) {
  console.log("Started syncing with", description);

  syncer.isDone().then(() => {
    console.log("Finished syncing with", description);

    const status = syncer.getStatus();

    for (const share in status) {
      const report = status[share];

      console.log(
        `Got ${report.docs.receivedCount} / ${report.docs.requestedCount} | Sent ${report.docs.sentCount} | Transfers: ${
          report.attachments.filter((transfer) =>
            transfer.status === "complete"
          ).length
        } / ${report.attachments.length}`,
      );
    }
  });
}
