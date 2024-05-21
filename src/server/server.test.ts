import type { IdentityKeypair } from "../identifiers/identity.ts";
import { Peer } from "../peer/peer.ts";
import { Server } from "./server.ts";

import type { ShareKeypair } from "../identifiers/share.ts";
import type { Cap } from "../caps/cap.ts";
import type { Store } from "../store/store.ts";
import { ExtensionSyncWebsocket } from "./extensions/sync_websocket.ts";
import { delay } from "@std/async";
import { assert, assertEquals } from "@std/assert";
import type { Syncer } from "../syncer/syncer.ts";
import { Path } from "../path/path.ts";
import { RuntimeDriverDeno } from "../runtime/driver_deno.ts";
import { StorageDriverMemory } from "../peer/storage_drivers/memory.ts";

Deno.test("Basic server setup", async () => {
  const peer = new Peer({
    password: "test1234",
    runtime: new RuntimeDriverDeno(),
    storage: new StorageDriverMemory(),
  });

  const suzyKeypair = await peer.createIdentity("suzy") as IdentityKeypair;
  const serverSettingsKeypair = await peer.createShare(
    "serversettings",
    false,
  ) as ShareKeypair;
  const cap = await peer.mintCap(
    serverSettingsKeypair.tag,
    suzyKeypair.tag,
    "read",
  ) as Cap;
  await peer.mintCap(
    serverSettingsKeypair.tag,
    suzyKeypair.tag,
    "write",
  );
  const settingsStore = await peer.getStore(serverSettingsKeypair.tag) as Store;

  const serverPeer = new Peer({
    password: "server123",
    runtime: new RuntimeDriverDeno(),
    storage: new StorageDriverMemory(),
  });
  const serverKeypair = await serverPeer.createIdentity(
    "serv",
  ) as IdentityKeypair;

  const forServerCap = await cap.delegate(serverKeypair.tag, {
    pathPrefix: Path.fromBytes(new Uint8Array([0])),
    identity: serverKeypair.tag,
  }) as Cap;

  await serverPeer.importCap(forServerCap.export());

  const authDoc = await settingsStore.set({
    path: Path.fromBytes(new Uint8Array([0]), new Uint8Array([1])),
    identity: serverKeypair.tag,
    payload: new Uint8Array([7, 7, 7]),
  });
  assert(authDoc.kind === "success");

  const server = new Server(
    [new ExtensionSyncWebsocket("sync")],
    { peer: serverPeer, port: 7123 },
  );

  const syncer = await peer.syncHttp(`http://localhost:7123/sync`) as Syncer;

  await delay(1000);

  const settingsStore2 = await serverPeer.getStore(
    serverSettingsKeypair.tag,
  ) as Store;

  const allDocs = [];

  for await (const doc of settingsStore2.documents()) {
    allDocs.push(doc);
  }

  assertEquals(allDocs.length, 1);
  assertEquals(allDocs[0].digest, authDoc.document.digest);

  syncer.close();
  server.close();
});
