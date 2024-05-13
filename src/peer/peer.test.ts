import { KvDriverInMemory } from "https://deno.land/x/willow@0.2.1/src/store/storage/kv/kv_driver_in_memory.ts";
import { Peer } from "./peer.ts";
import { Store } from "../store/store.ts";
import { encodeShareTag } from "../identifiers/share.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.203.0/assert/mod.ts";
import { notErr } from "../util/errors.ts";
import { encodeIdentityTag } from "../identifiers/identity.ts";

Deno.test("Peer", async () => {
  const peer = new Peer({
    password: "password1234",
    driver: {
      authDriver: new KvDriverInMemory(),
      createStore: (share) => {
        return Promise.resolve(new Store(encodeShareTag(share)));
      },
    },
  });

  assertEquals(await peer.shares(), []);

  const suzyId = await peer.createNewIdentity("suzy");
  assert(notErr(suzyId));

  const gardeningTag = await peer.createNewShare("gardening", true);
  assert(notErr(gardeningTag));

  const gardeningRootCap = await peer.mintCap(
    gardeningTag,
    encodeIdentityTag(suzyId.publicKey),
    "read",
  );
  assert(notErr(gardeningRootCap));

  assertEquals(await peer.shares(), [gardeningTag]);

  const gardeningStore = await peer.getStore(gardeningTag);
  assert(notErr(gardeningStore));
});
