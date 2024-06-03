import { assert, assertEquals } from "@std/assert";
import { Peer } from "./peer.ts";
import { notErr } from "../util/errors.ts";
import { Path } from "../path/path.ts";
import { RuntimeDriverDeno } from "../runtime/driver_deno.ts";
import { StorageDriverMemory } from "./storage_drivers/memory.ts";

Deno.test("Peer", async () => {
  // A Peer which can securely store capabilities and keypairs.
  const peer = new Peer({
    password: "password1234",
    runtime: new RuntimeDriverDeno(),
    storage: new StorageDriverMemory(),
  });

  // At this point the peer has no capabilities, so no shares.
  assertEquals(await peer.shares(), []);

  // Create a new identity keypair for us.
  const suzyKeypair = await peer.createIdentity("suzy");
  assert(notErr(suzyKeypair));

  // Create a new communal share (which need no secret, so no keypair returned)
  // (if this was an owned share we'd return a keypair)
  const gardeningTag = await peer.createShare("gardening", true);
  assert(notErr(gardeningTag));

  // Make a root capability for suzy to write to +gardening
  const gardeningRootCap = await peer.mintCap(
    gardeningTag,
    suzyKeypair.tag,
    "write",
  );
  assert(notErr(gardeningRootCap));

  // Now our Peer can produce stores to access +gardening
  assertEquals(await peer.shares(), [gardeningTag]);
  const gardeningStore = await peer.getStore(gardeningTag);
  assert(notErr(gardeningStore));

  // And even better, our Store knows about our capabilities,
  // And selects them automatically when creating new documents.
  const result = await gardeningStore.set({
    path: Path.fromStrings("hello"),
    identity: suzyKeypair.tag,
    payload: new TextEncoder().encode("yo!"),
  });
  assertEquals(result.kind, "success");
});

Deno.test("Peer with existing share", async () => {
  // A Peer which can securely store capabilities and keypairs.
  const peer = new Peer({
    password: "password1234",
    runtime: new RuntimeDriverDeno(),
    storage: new StorageDriverMemory(),
  });

  // Create a new identity keypair for us.
  const suzyKeypair = await peer.createIdentity("suzy");
  assert(notErr(suzyKeypair));

  // Use an existing share
  const gardeningTag = "+gardening.baaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  assert(notErr(await peer.addExistingShare(gardeningTag)));

  // Make a root capability for suzy to write to +gardening
  const gardeningRootCap = await peer.mintCap(
    gardeningTag,
    suzyKeypair.tag,
    "write",
  );
  assert(notErr(gardeningRootCap));

  // Now our Peer can produce stores to access +gardening
  assertEquals(await peer.shares(), [gardeningTag]);
  const gardeningStore = await peer.getStore(gardeningTag);
  assert(notErr(gardeningStore));

  // And even better, our Store knows about our capabilities,
  // And selects them automatically when creating new documents.
  const result = await gardeningStore.set({
    path: Path.fromStrings("hello"),
    identity: suzyKeypair.tag,
    payload: new TextEncoder().encode("yo!"),
  });
  assertEquals(result.kind, "success");
});
