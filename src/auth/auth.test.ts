import {
  assert,
  assertArrayIncludes,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.203.0/assert/mod.ts";
import { Auth, meadowcap } from "./auth.ts";
import { notErr } from "../util/errors.ts";
import { earthstarToWillowPath } from "../util/path.ts";
import { ANY_SUBSPACE } from "../../deps.ts";
import { isCommunalShare } from "../identifiers/share.ts";
import { KvDriverInMemory } from "https://deno.land/x/willow@0.2.1/src/store/storage/kv/kv_driver_in_memory.ts";
import { KvDriverDeno } from "https://deno.land/x/willow@0.2.1/src/store/storage/kv/kv_driver_deno.ts";

Deno.test("Auth passwords", async () => {
  const denoKv = new KvDriverDeno(await Deno.openKv());

  const auth = new Auth({ kvDriver: denoKv, password: "password1234" });

  await auth.ready();

  const auth2 = new Auth({ kvDriver: denoKv, password: "password1234" });

  await auth2.ready();

  await assertRejects(
    async () => {
      const auth3 = new Auth({ kvDriver: denoKv, password: "argggggggg" });
      await auth3.ready();
    },
  );

  Auth.reset(denoKv);

  const auth4 = new Auth({ kvDriver: denoKv, password: "password1234" });
  await auth4.ready();

  denoKv.close();
});

const memKv = () => new KvDriverInMemory();

Deno.test("Auth identities", async () => {
  const auth = new Auth({ password: "password1234", kvDriver: memKv() });

  const newIdentity = await auth.createIdentityKeypair("suzy");
  const newIdentity2 = await auth.createIdentityKeypair("buzy");

  assert(notErr(newIdentity));
  assert(notErr(newIdentity2));

  const identities = [];

  for await (const identity of auth.identityKeypairs()) {
    identities.push(identity);
  }

  assertArrayIncludes(identities, [newIdentity, newIdentity2]);

  const suzyRetrieved = await auth.identityKeypair(newIdentity.publicKey);

  assert(suzyRetrieved);
  assertEquals(suzyRetrieved.publicKey, newIdentity.publicKey);
});

Deno.test("Auth Shares", async () => {
  const auth = new Auth({ password: "password1234", kvDriver: memKv() });

  const newShare = await auth.createShareKeypair("gardening", true);
  const newShare2 = await auth.createShareKeypair("projects", false);

  assert(notErr(newShare));
  assert(notErr(newShare2));

  const shares = [];

  for await (const share of auth.shareKeypairs()) {
    shares.push(share);
  }

  assertArrayIncludes(shares, [newShare, newShare2]);

  const gardeningRetrieved = await auth.shareKeypair(newShare.publicKey);

  assert(gardeningRetrieved);
  assertEquals(gardeningRetrieved.publicKey, newShare.publicKey);
});

Deno.test("Auth Read cap packs", async () => {
  const auth = new Auth({ password: "password1234", kvDriver: memKv() });

  const newIdentity = await auth.createIdentityKeypair("suzy");

  assert(notErr(newIdentity));

  // Communal by default, owned is a second param.
  const gardeningShare = await auth.createShareKeypair("gardening", true);

  assert(notErr(gardeningShare));

  const capPack = await auth.createFullCapPack(
    gardeningShare.publicKey,
    newIdentity.publicKey,
    "read",
  );

  assert(notErr(capPack));
  assertEquals(capPack.readCap.accessMode, "read");
  assertEquals(capPack.readCap.namespaceKey, gardeningShare.publicKey);
  assertEquals(capPack.readCap.userKey, newIdentity.publicKey);
  assert(meadowcap.isValidCap(capPack.readCap));

  const mountainShare = await auth.createShareKeypair("mountain", false);

  assert(notErr(mountainShare));

  const mountainCapPack = await auth.createFullCapPack(
    mountainShare.publicKey,
    newIdentity.publicKey,
    "read",
    false,
  );

  assert(notErr(mountainCapPack));

  const allCapPacks = [];

  for await (
    const capPack of auth.readCapPacks()
  ) {
    allCapPacks.push(capPack);
  }

  assertArrayIncludes(allCapPacks, [capPack]);

  await auth.addCapPack(mountainCapPack);

  const gardeningCapPacks = [];

  // Fetch that one gardening cap pack out of storage.
  for await (
    const capPack of auth.readCapPacks(gardeningShare.publicKey)
  ) {
    gardeningCapPacks.push(capPack);
  }

  assertEquals(gardeningCapPacks, [capPack]);

  const allCapPacksAgain = [];

  for await (
    const capPack of auth.readCapPacks()
  ) {
    allCapPacksAgain.push(capPack);
  }

  assertArrayIncludes(allCapPacksAgain, [capPack, mountainCapPack]);
});

Deno.test("Auth Write cap packs", async () => {
  const auth = new Auth({ password: "password1234", kvDriver: memKv() });

  const newIdentity = await auth.createIdentityKeypair("suzy");

  assert(notErr(newIdentity));

  // Communal by default, owned is a second param.
  const gardeningShare = await auth.createShareKeypair("gardening", true);

  assert(notErr(gardeningShare));

  const capPack = await auth.createFullCapPack(
    gardeningShare.publicKey,
    newIdentity.publicKey,
    "write",
  );

  assert(notErr(capPack));

  assertEquals(capPack.writeCap.accessMode, "write");
  assertEquals(capPack.writeCap.namespaceKey, gardeningShare.publicKey);
  assertEquals(capPack.writeCap.userKey, newIdentity.publicKey);
  assert(meadowcap.isValidCap(capPack.writeCap));

  const mountainShare = await auth.createShareKeypair("mountain", false);

  assert(notErr(mountainShare));

  const mountainCapPack = await auth.createFullCapPack(
    mountainShare.publicKey,
    newIdentity.publicKey,
    "write",
    false,
  );

  assert(notErr(mountainCapPack));

  const allCapPacks = [];

  for await (
    const capPacks of auth.writeCapPacks()
  ) {
    allCapPacks.push(capPacks);
  }

  assertArrayIncludes(allCapPacks, [capPack]);

  await auth.addCapPack(mountainCapPack);

  const gardeningCapPacks = [];

  // Fetch that one gardening cap pack out of storage.
  for await (
    const capPack of auth.writeCapPacks(gardeningShare.publicKey)
  ) {
    gardeningCapPacks.push(capPack);
  }

  assertEquals(gardeningCapPacks, [capPack]);

  const allCapPacksAgain = [];

  for await (
    const capPacks of auth.writeCapPacks()
  ) {
    allCapPacksAgain.push(capPacks);
  }

  assertArrayIncludes(allCapPacksAgain, [capPack, mountainCapPack]);
});

Deno.test("Delegate (communal, write)", async () => {
  const auth = new Auth({ password: "password1234", kvDriver: memKv() });

  const newIdentity = await auth.createIdentityKeypair("suzy");

  assert(notErr(newIdentity));

  // Communal by default, owned is a second param.
  const gardeningShare = await auth.createShareKeypair("gardening", false);

  assert(notErr(gardeningShare));

  const capPack = await auth.createFullCapPack(
    gardeningShare.publicKey,
    newIdentity.publicKey,
    "write",
  );

  assert(notErr(capPack));

  const newIdentity2 = await auth.createIdentityKeypair("buzy");

  assert(notErr(newIdentity2));

  const delegated = await auth.delegateCapPack({
    capPack,
    restrictTo: {
      pathPrefix: ["hello"],
      time: {
        start: 2n,
        end: 10n,
      },
    },
    toUser: newIdentity2.publicKey,
    userSecret: newIdentity.secretKey,
  });

  assert(notErr(delegated));
  assert(auth.isValidCapPack(delegated));
  assertEquals(meadowcap.getCapGrantedArea(delegated.writeCap), {
    includedSubspaceId: newIdentity.publicKey,
    pathPrefix: earthstarToWillowPath(["hello"]) as Uint8Array[],
    timeRange: {
      start: 2n,
      end: 10n,
    },
  });
});

Deno.test("Delegate (communal, read)", async () => {
  const auth = new Auth({ password: "password1234", kvDriver: memKv() });

  const newIdentity = await auth.createIdentityKeypair("suzy");

  assert(notErr(newIdentity));

  // Communal by default, owned is a second param.
  const gardeningShare = await auth.createShareKeypair("gardening", false);

  assert(notErr(gardeningShare));

  const capPack = await auth.createFullCapPack(
    gardeningShare.publicKey,
    newIdentity.publicKey,
    "read",
  );

  assert(notErr(capPack));

  const newIdentity2 = await auth.createIdentityKeypair("buzy");

  assert(notErr(newIdentity2));

  const delegated = await auth.delegateCapPack({
    capPack,
    restrictTo: {
      pathPrefix: ["hello"],
      time: {
        start: 2n,
        end: 10n,
      },
    },
    toUser: newIdentity2.publicKey,
    userSecret: newIdentity.secretKey,
  });

  assert(notErr(delegated));
  assert(auth.isValidCapPack(delegated));
  assertEquals(meadowcap.getCapGrantedArea(delegated.readCap), {
    includedSubspaceId: newIdentity.publicKey,
    pathPrefix: earthstarToWillowPath(["hello"]) as Uint8Array[],
    timeRange: {
      start: 2n,
      end: 10n,
    },
  });
});

Deno.test("Delegate (owned, read)", async () => {
  const auth = new Auth({ password: "password1234", kvDriver: memKv() });

  const newIdentity = await auth.createIdentityKeypair("suzy");

  assert(notErr(newIdentity));

  // Communal by default, owned is a second param.
  const gardeningShare = await auth.createShareKeypair("gardening", true);

  assert(notErr(gardeningShare));
  assert(!isCommunalShare(gardeningShare.publicKey));

  const capPack = await auth.createFullCapPack(
    gardeningShare.publicKey,
    newIdentity.publicKey,
    "read",
  );

  assert(notErr(capPack));
  assert(capPack.subspaceCap);

  const newIdentity2 = await auth.createIdentityKeypair("buzy");

  assert(notErr(newIdentity2));

  const delegated = await auth.delegateCapPack({
    capPack,
    restrictTo: {
      pathPrefix: ["hello"],
      time: {
        start: 2n,
        end: 10n,
      },
    },
    toUser: newIdentity2.publicKey,
    userSecret: newIdentity.secretKey,
  });

  assert(notErr(delegated));
  assert(auth.isValidCapPack(delegated));
  assertEquals(meadowcap.getCapGrantedArea(delegated.readCap), {
    includedSubspaceId: ANY_SUBSPACE,
    pathPrefix: earthstarToWillowPath(["hello"]) as Uint8Array[],
    timeRange: {
      start: 2n,
      end: 10n,
    },
  });
  assert(delegated.subspaceCap);
});

Deno.test("Delegate (owned, write)", async () => {
  const auth = new Auth({ password: "password1234", kvDriver: memKv() });

  const newIdentity = await auth.createIdentityKeypair("suzy");

  assert(notErr(newIdentity));

  // Communal by default, owned is a second param.
  const gardeningShare = await auth.createShareKeypair("gardening", true);

  assert(notErr(gardeningShare));
  assert(!isCommunalShare(gardeningShare.publicKey));

  const capPack = await auth.createFullCapPack(
    gardeningShare.publicKey,
    newIdentity.publicKey,
    "write",
  );

  assert(notErr(capPack));

  const newIdentity2 = await auth.createIdentityKeypair("buzy");

  assert(notErr(newIdentity2));

  const delegated = await auth.delegateCapPack({
    capPack,
    restrictTo: {
      pathPrefix: ["hello"],
      time: {
        start: 2n,
        end: 10n,
      },
    },
    toUser: newIdentity2.publicKey,
    userSecret: newIdentity.secretKey,
  });

  assert(notErr(delegated));
  assert(auth.isValidCapPack(delegated));
  assertEquals(meadowcap.getCapGrantedArea(delegated.writeCap), {
    includedSubspaceId: ANY_SUBSPACE,
    pathPrefix: earthstarToWillowPath(["hello"]) as Uint8Array[],
    timeRange: {
      start: 2n,
      end: 10n,
    },
  });
});
