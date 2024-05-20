import {
  assert,
  assertArrayIncludes,
  assertEquals,
  assertRejects,
} from "@std/assert";
import { ANY_SUBSPACE } from "@earthstar/willow-utils";
import { KvDriverInMemory } from "@earthstar/willow";
import { KvDriverDeno } from "@earthstar/willow/deno";
import * as Meadowcap from "@earthstar/meadowcap";
import { Auth } from "./auth.ts";
import { notErr } from "../util/errors.ts";

import { isCommunalShare } from "../identifiers/share.ts";

import { meadowcapParams } from "../schemes/schemes.ts";
import { Path } from "../path/path.ts";

const meadowcap = new Meadowcap.Meadowcap(meadowcapParams);

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

  const newShare = await auth.createShareKeypair("gardening", false);
  const newShare2 = await auth.createShareKeypair("projects", true);

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
    const capPack of auth.readCapPacks([{ share: gardeningShare.publicKey }])
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

  // Do area selectors work?

  const delegated = await auth.delegateCapPack({
    capPack: mountainCapPack,
    toUser: newIdentity.publicKey,
    restrictTo: {
      pathPrefix: Path.fromBytes(new Uint8Array([1])),
      time: {
        start: 100n,
        end: 900n,
      },
    },
  });
  assert(notErr(delegated));

  const auth2 = new Auth({ password: "password1234", kvDriver: memKv() });
  assert(notErr(await auth2.addIdentityKeypair(newIdentity)));
  assert(notErr(await auth2.addCapPack(delegated)));

  const restrictedCapPacks = [];

  for await (
    const capPack of auth2.readCapPacks([{
      share: mountainShare.publicKey,
      areas: [{
        includedSubspaceId: newIdentity.publicKey,
        pathPrefix: [new Uint8Array([1]), new Uint8Array([2])],
        timeRange: {
          start: 500n,
          end: 900n,
        },
      }],
    }])
  ) {
    restrictedCapPacks.push(capPack);
  }

  assertEquals(restrictedCapPacks.length, 1);
  assertArrayIncludes(restrictedCapPacks, [delegated]);
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
    const capPack of auth.writeCapPacks([{ share: gardeningShare.publicKey }])
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

  // Do area selectors work?

  const delegated = await auth.delegateCapPack({
    capPack: mountainCapPack,
    toUser: newIdentity.publicKey,
    restrictTo: {
      pathPrefix: Path.fromBytes(new Uint8Array([1])),
      time: {
        start: 100n,
        end: 900n,
      },
    },
  });
  assert(notErr(delegated));

  const auth2 = new Auth({ password: "password1234", kvDriver: memKv() });
  assert(notErr(await auth2.addIdentityKeypair(newIdentity)));
  assert(notErr(await auth2.addCapPack(delegated)));

  const restrictedCapPacks = [];

  for await (
    const capPack of auth2.writeCapPacks([{
      share: mountainShare.publicKey,
      areas: [{
        includedSubspaceId: newIdentity.publicKey,
        pathPrefix: [new Uint8Array([1]), new Uint8Array([2])],
        timeRange: {
          start: 500n,
          end: 900n,
        },
      }],
    }])
  ) {
    restrictedCapPacks.push(capPack);
  }

  assertEquals(restrictedCapPacks.length, 1);
  assertArrayIncludes(restrictedCapPacks, [delegated]);
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
      pathPrefix: Path.fromBytes(new Uint8Array([1])),
      time: {
        start: 2n,
        end: 10n,
      },
    },
    toUser: newIdentity2.publicKey,
  });

  assert(notErr(delegated));
  assert(auth.isValidCapPack(delegated));
  assertEquals(meadowcap.getCapGrantedArea(delegated.writeCap), {
    includedSubspaceId: newIdentity.publicKey,
    pathPrefix: [new Uint8Array([1])],
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
      pathPrefix: Path.fromBytes(new Uint8Array([1])),
      time: {
        start: 2n,
        end: 10n,
      },
    },
    toUser: newIdentity2.publicKey,
  });

  assert(notErr(delegated));
  assert(auth.isValidCapPack(delegated));
  assertEquals(meadowcap.getCapGrantedArea(delegated.readCap), {
    includedSubspaceId: newIdentity.publicKey,
    pathPrefix: [new Uint8Array([1])],
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
      pathPrefix: Path.fromBytes(new Uint8Array([1])),
      time: {
        start: 2n,
        end: 10n,
      },
    },
    toUser: newIdentity2.publicKey,
  });

  assert(notErr(delegated));
  assert(auth.isValidCapPack(delegated));
  assertEquals(meadowcap.getCapGrantedArea(delegated.readCap), {
    includedSubspaceId: ANY_SUBSPACE,
    pathPrefix: [new Uint8Array([1])],
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
      pathPrefix: Path.fromBytes(new Uint8Array([1])),
      time: {
        start: 2n,
        end: 10n,
      },
    },
    toUser: newIdentity2.publicKey,
  });

  assert(notErr(delegated));
  assert(auth.isValidCapPack(delegated));
  assertEquals(meadowcap.getCapGrantedArea(delegated.writeCap), {
    includedSubspaceId: ANY_SUBSPACE,
    pathPrefix: [new Uint8Array([1])],
    timeRange: {
      start: 2n,
      end: 10n,
    },
  });
});

Deno.test("Auth.getWriteAuthorisation", async () => {
  const auth = new Auth({ password: "password1234", kvDriver: memKv() });

  // Communal by default, owned is a second param.
  const gardeningShare = await auth.createShareKeypair("gardening", true);

  assert(notErr(gardeningShare));
  assert(!isCommunalShare(gardeningShare.publicKey));

  const newIdentity = await auth.createIdentityKeypair("suzy");

  assert(notErr(newIdentity));

  const res1 = await auth.getWriteAuthorisation(
    gardeningShare.publicKey,
    newIdentity.publicKey,
    Path.empty,
    0n,
  );

  assertEquals(res1, undefined);

  const capPack = await auth.createFullCapPack(
    gardeningShare.publicKey,
    newIdentity.publicKey,
    "write",
  );
  assert(notErr(capPack));

  const res2 = await auth.getWriteAuthorisation(
    gardeningShare.publicKey,
    newIdentity.publicKey,
    Path.empty,
    0n,
  );

  assertEquals(res2, {
    cap: capPack.writeCap,
    receiverKeypair: newIdentity,
  });

  const delegated = await auth.delegateCapPack({
    capPack,
    toUser: newIdentity.publicKey,
    restrictTo: {
      pathPrefix: Path.fromBytes(new Uint8Array([8])),
      identity: newIdentity.publicKey,
      time: {
        start: 10n,
        end: 20n,
      },
    },
  });
  assert(notErr(delegated));
  assert(notErr(await auth.addCapPack(delegated)));

  const res3 = await auth.getWriteAuthorisation(
    gardeningShare.publicKey,
    newIdentity.publicKey,
    Path.fromBytes(new Uint8Array([8]), new Uint8Array([8])),
    15n,
  );
  assert(notErr(res3));

  assertEquals(res3, {
    cap: capPack.writeCap,
    receiverKeypair: newIdentity,
  });

  // Let's double check using another auth.

  const auth2 = new Auth({ password: "password1234", kvDriver: memKv() });

  assert(notErr(await auth2.addIdentityKeypair(newIdentity)));
  assert(notErr(await auth2.addCapPack(delegated)));

  const res4 = await auth2.getWriteAuthorisation(
    gardeningShare.publicKey,
    newIdentity.publicKey,
    Path.fromBytes(new Uint8Array([8]), new Uint8Array([8])),
    15n,
  );
  assert(notErr(res4));

  assertEquals(res4, {
    cap: delegated.writeCap,
    receiverKeypair: newIdentity,
  });

  assert(notErr(await auth2.addCapPack(capPack)));

  const res5 = await auth2.getWriteAuthorisation(
    gardeningShare.publicKey,
    newIdentity.publicKey,
    Path.fromBytes(new Uint8Array([8]), new Uint8Array([8])),
    15n,
  );
  assert(notErr(res5));

  assertEquals(res5, {
    cap: capPack.writeCap,
    receiverKeypair: newIdentity,
  });
});

Deno.test("Auth.interestsFromCaps", async () => {
  const auth = new Auth({ password: "password1234", kvDriver: memKv() });

  const gardeningShare = await auth.createShareKeypair("gardening", true);

  assert(notErr(gardeningShare));
  assert(!isCommunalShare(gardeningShare.publicKey));

  const newIdentity = await auth.createIdentityKeypair("suzy");
  assert(notErr(newIdentity));

  // Setup.
  const fullCap = await auth.createFullCapPack(
    gardeningShare.publicKey,
    newIdentity.publicKey,
    "read",
  );
  assert(notErr(fullCap));

  const capA = await auth.delegateCapPack({
    capPack: fullCap,
    toUser: newIdentity.publicKey,
    restrictTo: {
      time: {
        start: 0n,
        end: 1000n,
      },
    },
  });
  assert(notErr(capA));

  const capAa = await auth.delegateCapPack({
    capPack: fullCap,
    toUser: newIdentity.publicKey,
    restrictTo: {
      time: {
        start: 250n,
        end: 750n,
      },
    },
  });
  assert(notErr(capAa));

  const capB = await auth.delegateCapPack({
    capPack: fullCap,
    toUser: newIdentity.publicKey,
    restrictTo: {
      time: {
        start: 750n,
        end: 1500n,
      },
    },
  });
  assert(notErr(capB));

  const auth2 = new Auth({ password: "password1234", kvDriver: memKv() });

  await auth2.addIdentityKeypair(newIdentity);
  await auth2.addCapPack(capA);
  await auth2.addCapPack(capAa);
  await auth2.addCapPack(capB);

  const interests = await auth2.interestsFromCaps();

  assertEquals(interests.size, 2);
  assertArrayIncludes(
    Array.from(interests.keys()),
    [capA, capB].map((pack) => {
      return {
        capability: pack.readCap,
        subspaceCapability: pack.subspaceCap,
      };
    }),
  );
});
