import { assert, assertEquals } from "@std/assert";
import { KvDriverInMemory } from "@earthstar/willow";
import { Auth } from "../auth/auth.ts";
import { notErr } from "../util/errors.ts";
import { Cap } from "./cap.ts";
import { encodeIdentityTag } from "../identifiers/identity.ts";
import { encodeShareTag } from "../identifiers/share.ts";
import { Path } from "../path/path.ts";

Deno.test("Cap semantics (communal)", async () => {
  const auth = new Auth({
    password: "hello",
    kvDriver: new KvDriverInMemory(),
  });

  const id = await auth.createIdentityKeypair("suzy");
  assert(notErr(id));
  const share = await auth.createShareKeypair("gardening", false);
  assert(notErr(share));

  const readCapPack = await auth.createFullCapPack(
    share.publicKey,
    id.publicKey,
    "read",
  );
  assert(notErr(readCapPack));

  const readCap = new Cap(readCapPack, auth);

  assertEquals(readCap.share, encodeShareTag(share.publicKey));
  assertEquals(readCap.receiver, encodeIdentityTag(id.publicKey));
  assertEquals(readCap.accessMode, "read");
  assertEquals(readCap.grantedIdentity, encodeIdentityTag(id.publicKey));
  assertEquals(readCap.grantedPathPrefix.underlying, Path.empty.underlying);
  assertEquals(readCap.grantedTime, {
    start: 0n,
    end: undefined,
  });
  assertEquals(readCap.delegatedTimes, 0);

  const writeCapPack = await auth.createFullCapPack(
    share.publicKey,
    id.publicKey,
    "write",
  );
  assert(notErr(writeCapPack));

  const writeCap = new Cap(writeCapPack, auth);

  assertEquals(writeCap.share, encodeShareTag(share.publicKey));
  assertEquals(writeCap.receiver, encodeIdentityTag(id.publicKey));
  assertEquals(writeCap.accessMode, "write");
  assertEquals(writeCap.grantedIdentity, encodeIdentityTag(id.publicKey));
  assertEquals(writeCap.grantedPathPrefix.underlying, Path.empty.underlying);
  assertEquals(writeCap.grantedTime, {
    start: 0n,
    end: undefined,
  });
  assertEquals(writeCap.delegatedTimes, 0);
});

Deno.test("Cap semantics (owned)", async () => {
  const auth = new Auth({
    password: "hello",
    kvDriver: new KvDriverInMemory(),
  });

  const id = await auth.createIdentityKeypair("suzy");
  assert(notErr(id));
  const share = await auth.createShareKeypair("gardening", true);
  assert(notErr(share));

  const readCapPack = await auth.createFullCapPack(
    share.publicKey,
    id.publicKey,
    "read",
  );
  assert(notErr(readCapPack));

  const readCap = new Cap(readCapPack, auth);

  assertEquals(readCap.share, encodeShareTag(share.publicKey));
  assertEquals(readCap.receiver, encodeIdentityTag(id.publicKey));
  assertEquals(readCap.accessMode, "read");
  assertEquals(readCap.grantedIdentity, undefined);
  assertEquals(readCap.grantedPathPrefix.underlying, Path.empty.underlying);
  assertEquals(readCap.grantedTime, {
    start: 0n,
    end: undefined,
  });
  assertEquals(readCap.delegatedTimes, 0);

  const writeCapPack = await auth.createFullCapPack(
    share.publicKey,
    id.publicKey,
    "write",
  );
  assert(notErr(writeCapPack));

  const writeCap = new Cap(writeCapPack, auth);

  assertEquals(writeCap.share, encodeShareTag(share.publicKey));
  assertEquals(writeCap.receiver, encodeIdentityTag(id.publicKey));
  assertEquals(writeCap.accessMode, "write");
  assertEquals(writeCap.grantedIdentity, undefined);
  assertEquals(writeCap.grantedPathPrefix.underlying, Path.empty.underlying);
  assertEquals(writeCap.grantedTime, {
    start: 0n,
    end: undefined,
  });
  assertEquals(writeCap.delegatedTimes, 0);
});

Deno.test("Cap delegation", async () => {
  const auth = new Auth({
    password: "hello",
    kvDriver: new KvDriverInMemory(),
  });

  const id = await auth.createIdentityKeypair("suzy");
  assert(notErr(id));
  const share = await auth.createShareKeypair("gardening", true);
  assert(notErr(share));

  const readCapPack = await auth.createFullCapPack(
    share.publicKey,
    id.publicKey,
    "read",
  );
  assert(notErr(readCapPack));

  const readCap = new Cap(readCapPack, auth);

  const id2 = await auth.createIdentityKeypair("greg");
  assert(notErr(id2));

  const tag2 = encodeIdentityTag(id2.publicKey);
  assert(notErr(tag2));

  const delegatedFull = await readCap.delegate(
    tag2,
  );

  assert(notErr(delegatedFull));
  assert(delegatedFull.receiver, tag2);
  assertEquals(delegatedFull.share, readCap.share);
  assertEquals(delegatedFull.accessMode, "read");
  assertEquals(delegatedFull.grantedIdentity, readCap.grantedIdentity);
  assertEquals(delegatedFull.grantedPathPrefix, readCap.grantedPathPrefix);
  assertEquals(delegatedFull.grantedTime, readCap.grantedTime);
  assertEquals(delegatedFull.delegatedTimes, 1);

  const delegatedRestricted = await readCap.delegate(
    tag2,
    {
      identity: tag2,
      pathPrefix: new Path([new Uint8Array([7, 7, 7])]),
      time: {
        start: 10n,
        end: 90n,
      },
    },
  );

  assert(notErr(delegatedRestricted));
  assert(delegatedRestricted.receiver, tag2);
  assertEquals(delegatedRestricted.share, readCap.share);
  assertEquals(delegatedRestricted.accessMode, "read");
  assertEquals(delegatedRestricted.grantedIdentity, tag2);
  assertEquals(delegatedRestricted.grantedPathPrefix.underlying, [
    new Uint8Array([7, 7, 7]),
  ]);
  assertEquals(delegatedRestricted.grantedTime, {
    start: 10n,
    end: 90n,
  });
  assertEquals(delegatedRestricted.delegatedTimes, 1);
});
