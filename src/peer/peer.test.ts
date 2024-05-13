import { Peer } from "./peer.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.203.0/assert/mod.ts";
import { notErr } from "../util/errors.ts";

Deno.test("Peer", async () => {
  const peer = new Peer({ password: "password1234" });

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
    "read",
  );
  assert(notErr(gardeningRootCap));

  // Now our Peer can produce stores to access +gardening
  assertEquals(await peer.shares(), [gardeningTag]);

  const gardeningStore = await peer.getStore(gardeningTag);
  assert(notErr(gardeningStore));
});
