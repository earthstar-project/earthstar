import { assertEquals, assert } from "@std/assert";
import { Peer } from "../peer/peer.ts";
import { RuntimeDriverUniversal } from "../runtime/driver_universal.ts";
import { StorageDriverMemory } from "../peer/storage_drivers/memory.ts";
import { Path } from "../path/path.ts";
import { syncInMemory } from "./sync_in_memory.ts";
import type { EarthstarError } from "../../mod.ts";
import { isErr } from "../util/errors.ts";
import { delay } from "@std/async/delay";

const handleErr = <T>(data: T | EarthstarError): T => {
  if (isErr(data)) throw data;
  return data;
};

Deno.test("Sync 2 Peers In Memory", async () => {
  const p1 = new Peer({
    password: "password",
    runtime: new RuntimeDriverUniversal(),
    storage: new StorageDriverMemory(),
  });
  const p2 = new Peer({
    password: "password",
    runtime: new RuntimeDriverUniversal(),
    storage: new StorageDriverMemory(),
  });
  const id1 = handleErr(await p1.createIdentity("mid1"));
  const id2 = handleErr(await p2.createIdentity("mid2"));

  const share = handleErr(await p1.createShare("share", false));

  const capRead1 = handleErr(await p1.mintCap(share.tag, id1.tag, "write"));
  const capWrite1 = handleErr(await p1.mintCap(share.tag, id1.tag, "read"));

  // TODO(zicklag): using these to lines instead of the following will not work, but I think they should.
  // const capRead2 = handleErr(await p1.mintCap(share, id2.tag, "write"));
  // const capWrite2 = handleErr(await p1.mintCap(share, id2.tag, "read"));

  const capRead2 = handleErr(await capRead1.delegate(id2.tag));
  const capWrite2 = handleErr(await capWrite1.delegate(id2.tag));

  const store1 = handleErr(await p1.getStore(share.tag));

  handleErr(
    await store1.set({
      identity: id1.tag,
      path: Path.fromStrings("hello"),
      payload: new TextEncoder().encode("world"),
    })
  );

  handleErr(await p2.importCap(capRead2.export()));
  handleErr(await p2.importCap(capWrite2.export()));

  const closeSync = handleErr(
    await syncInMemory(p1, p2, {
      runtime: new RuntimeDriverUniversal(),
    })
  );

  await delay(1000);

  closeSync();

  const store2 = handleErr(await p2.getStore(share.tag));

  const get = handleErr(await store2.get(id1.tag, Path.fromStrings("hello")));
  assert(get && get.payload, "Record not synced");
  const valueBytes = handleErr(await get.payload.bytes());
  const valueStr = handleErr(new TextDecoder().decode(valueBytes));
  assertEquals(valueStr, "world");
});
