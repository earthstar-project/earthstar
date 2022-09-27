import { emptyDir } from "https://deno.land/std@0.154.0/fs/empty_dir.ts";
import { ensureDir } from "https://deno.land/std@0.154.0/fs/ensure_dir.ts";
import { join } from "https://deno.land/std@0.154.0/path/mod.ts";
import { MANIFEST_FILE_NAME } from "../../sync-fs/constants.ts";
import { syncReplicaAndFsDir } from "../../sync-fs/sync-fs.ts";
import { SyncFsManifest } from "../../sync-fs/sync-fs-types.ts";

import { Crypto } from "../../crypto/crypto.ts";
import { Replica } from "../../replica/replica.ts";
import { DocDriverMemory } from "../../replica/doc_drivers/memory.ts";
import { AttachmentDriverMemory } from "../../replica/attachment_drivers/memory.ts";
import { sleep } from "../../util/misc.ts";
import { EarthstarError, isErr } from "../../util/errors.ts";
import { assert, assertEquals, assertRejects } from "../asserts.ts";
import { AuthorKeypair } from "../../crypto/crypto-types.ts";

const TEST_DIR = "src/test/fs-sync/dirs/sync_share_dir";

function makeReplica(address: string, shareSecret: string) {
  const driver = new DocDriverMemory(address);
  return new Replica({
    driver: {
      docDriver: driver,
      attachmentDriver: new AttachmentDriverMemory(),
    },
    shareSecret,
  });
}

Deno.test("syncShareAndDir", async (test) => {
  const keypairA = await Crypto.generateAuthorKeypair(
    "aaaa",
  ) as AuthorKeypair;
  const keypairB = await Crypto.generateAuthorKeypair(
    "bbbb",
  ) as AuthorKeypair;

  const shareKeypair = await Crypto.generateShareKeypair("syncfstest");
  const otherShareKeypair = await Crypto.generateShareKeypair(
    "syncfstestother",
  );

  assert(!isErr(shareKeypair));
  assert(!isErr(otherShareKeypair));

  // Throws if the dir is dirty and there is no manifest + the option is on.

  await ensureDir(TEST_DIR);
  await emptyDir(TEST_DIR);
  await Deno.writeTextFile(join(TEST_DIR, "dirty"), "heh");

  const TEST_SHARE = shareKeypair.shareAddress;
  const OTHER_TEST_SHARE = otherShareKeypair.shareAddress;

  await test.step("can't sync a dirty folder without a manifest", async () => {
    const replica = makeReplica(TEST_SHARE, shareKeypair.secret);

    await assertRejects(
      () => {
        return syncReplicaAndFsDir({
          dirPath: TEST_DIR,
          allowDirtyDirWithoutManifest: false,
          keypair: keypairA,
          replica: replica,
        });
      },
      EarthstarError,
      "Tried to sync a directory for the first time, but it was not empty.",
      "throws on trying to sync dirty folder without a manifest",
    );

    assertEquals(
      await syncReplicaAndFsDir({
        allowDirtyDirWithoutManifest: true,
        dirPath: TEST_DIR,
        keypair: keypairA,
        replica: replica,
      }),
      undefined,
      "does not throw on trying to sync dirty folder without manifest when manually overridden",
    );

    await replica.close(true);
  });

  await emptyDir(TEST_DIR);

  // Throws if the replica address does not match the manifest address

  await test.step("can't sync a directory which was synced with another share", async () => {
    const replica = makeReplica(TEST_SHARE, "");
    const otherReplica = makeReplica(OTHER_TEST_SHARE, "");

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: false,
      keypair: keypairA,
      replica: replica,
    });

    await assertRejects(
      () => {
        return syncReplicaAndFsDir({
          dirPath: TEST_DIR,
          allowDirtyDirWithoutManifest: false,
          keypair: keypairA,
          replica: otherReplica,
        });
      },
      EarthstarError,
      "Tried to sync a replica for",
      "throws when trying to sync with a folder which had been synced with another share",
    );

    await replica.close(true);
    await otherReplica.close(true);
  });

  await emptyDir(TEST_DIR);

  // Throws if you try to change a file at an owned path
  await test.step("throws when you try to change a file at someone else's owned path", async () => {
    const replica = makeReplica(TEST_SHARE, shareKeypair.secret);

    const ownedPath = join(TEST_DIR, `~${keypairB.address}`);

    await replica.set(keypairB, {
      path: `/~${keypairB.address}/mine`,
      text: "Only Keypair B can change this",
    });

    // Sync the owned doc to the fs.
    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica: replica,
    });

    // This should not throw.
    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica: replica,
    });

    await Deno.writeTextFile(
      join(ownedPath, "mine"),
      "Ho",
    );

    await assertRejects(
      () => {
        return syncReplicaAndFsDir({
          dirPath: TEST_DIR,
          allowDirtyDirWithoutManifest: true,
          keypair: keypairA,
          replica: replica,
        });
      },
      EarthstarError,
      `author ${keypairA.address} can't write to path`,
      "trying to write a file at someone else's own path",
    );

    replica.close(true);

    await emptyDir(TEST_DIR);

    const replica2 = makeReplica(TEST_SHARE, shareKeypair.secret);

    // Want to guard against a specific sequence of events.
    // Which is...

    // Replica sets a doc
    await replica2.set(keypairB, {
      path: `/~${keypairB.address}/special-case`,
      text: "A",
    });

    // We sync it to the FS
    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica: replica2,
    });

    //  Replica sets again
    await replica2.set(keypairB, {
      path: `/~${keypairB.address}/special-case`,
      text: "B",
    });

    // But before syncing, we bump the modified timestamp of the file.
    // Now we have a file which looks newer but with the old content.
    const specialCasePath = join(
      TEST_DIR,
      `~${keypairB.address}`,
      `special-case`,
    );

    const touch = Deno.run({ cmd: ["touch", specialCasePath] });
    await touch.status();
    touch.close();

    // This shouldn't throw.
    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica: replica2,
    });

    const specialContents = await Deno.readTextFile(specialCasePath);

    assertEquals(
      specialContents,
      "B",
      "Document at owned path is new value, even though it was modified out of order.",
    );

    await emptyDir(TEST_DIR);

    await replica2.close(true);

    // Test attachments

    const replica3 = makeReplica(TEST_SHARE, shareKeypair.secret);

    await ensureDir(ownedPath);

    await Deno.writeTextFile(
      join(ownedPath, "mine.txt"),
      "Lalala",
    );

    await assertRejects(
      () => {
        return syncReplicaAndFsDir({
          dirPath: TEST_DIR,
          allowDirtyDirWithoutManifest: true,
          keypair: keypairA,
          replica: replica3,
        });
      },
      EarthstarError,
      `author ${keypairA.address} can't write to path`,
      "trying to write a file at someone else's own path",
    );

    await replica3.close(true);
  });

  await emptyDir(TEST_DIR);

  // Throws if you try to delete a file at an owned path
  await test.step("can forcibly overwrite files at owned paths", async () => {
    const ownedPath = join(TEST_DIR, `~${keypairB.address}/doc`);

    await ensureDir(join(TEST_DIR, `~${keypairB.address}`));

    const replica = makeReplica(TEST_SHARE, shareKeypair.secret);

    await Deno.writeTextFile(
      ownedPath,
      "Not okay!",
    );

    await assertRejects(
      () => {
        return syncReplicaAndFsDir({
          dirPath: TEST_DIR,
          allowDirtyDirWithoutManifest: true,
          keypair: keypairA,
          replica,
        });
      },
      EarthstarError,
      `author ${keypairA.address} can't write to path`,
      "trying to modify a file at someone's else's owned path",
    );

    await replica.set(keypairB, {
      text: "Okay",
      path: `/~${keypairB.address}/doc`,
    });

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica,
      overwriteFilesAtOwnedPaths: true,
    });

    const ownedContents = await Deno.readTextFile(ownedPath);

    assertEquals(
      ownedContents,
      "Okay",
      "File at owned path was forcibly overwritten.",
    );

    await Deno.remove(ownedPath);

    await assertRejects(
      () => {
        return syncReplicaAndFsDir({
          dirPath: TEST_DIR,
          allowDirtyDirWithoutManifest: true,
          keypair: keypairA,
          replica,
        });
      },
      EarthstarError,
      `author ${keypairA.address} can't write to path`,
      "trying to delete a file at someone's else's owned path",
    );

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica,
      overwriteFilesAtOwnedPaths: true,
    });

    const ownedContents2 = await Deno.readTextFile(ownedPath);

    assertEquals(
      ownedContents2,
      "Okay",
      "File at owned path was forcibly overwritten.",
    );

    await replica.close(true);
  });

  await emptyDir(TEST_DIR);

  // Throws if you try to delete a file at an owned path
  await test.step("throws when you try to delete a file at someone else's owned path", async () => {
    const replica = makeReplica(TEST_SHARE, shareKeypair.secret);

    const ownedPath = join(TEST_DIR, `~${keypairB.address}`);

    await ensureDir(ownedPath);

    const manifest: SyncFsManifest = {
      share: TEST_SHARE,
      entries: {
        [`/~${keypairB.address}/mine.txt`]: {
          fileLastSeenMs: 0,
          path: `/~${keypairB.address}/mine.txt`,
        },
      },
    };

    await Deno.writeTextFile(
      join(TEST_DIR, MANIFEST_FILE_NAME),
      JSON.stringify(manifest),
    );

    await assertRejects(
      () => {
        return syncReplicaAndFsDir({
          dirPath: TEST_DIR,
          allowDirtyDirWithoutManifest: false,
          keypair: keypairA,
          replica,
        });
      },
      EarthstarError,
      `author ${keypairA.address} can't write to path`,
      "throws when trying to delete a file at someone's else's own path",
    );

    // Test attachments

    await replica.set(keypairB, {
      text: "A short message",
      path: `/~${keypairB.address}/message.txt`,
      attachment: new TextEncoder().encode("Hello"),
    });

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica,
      overwriteFilesAtOwnedPaths: true,
    });

    await Deno.remove(join(TEST_DIR, `~${keypairB.address}`, "message.txt"));

    await assertRejects(
      () => {
        return syncReplicaAndFsDir({
          dirPath: TEST_DIR,
          allowDirtyDirWithoutManifest: true,
          keypair: keypairA,
          replica,
        });
      },
      EarthstarError,
      `author ${keypairA.address} can't write to path`,
      "trying to delete a file at someone's else's owned path",
    );

    await replica.close(true);
  });

  await emptyDir(TEST_DIR);

  // Throws if a file has an invalid path
  await test.step("throws when you write a file at an invalid path", async () => {
    const replica = makeReplica(TEST_SHARE, shareKeypair.secret);

    const invalidPath = join(TEST_DIR, `/@invalid`);

    await Deno.writeTextFile(
      invalidPath,
      "!",
    );

    await assertRejects(
      () => {
        return syncReplicaAndFsDir({
          dirPath: TEST_DIR,
          allowDirtyDirWithoutManifest: true,
          keypair: keypairA,
          replica,
        });
      },
      EarthstarError,
      `invalid path`,
      "throws when trying to write an invalid path",
    );

    await emptyDir(TEST_DIR);

    // Attachments

    const invalidPathAttachment = join(TEST_DIR, `/@invalid.txt`);

    await Deno.writeTextFile(
      invalidPathAttachment,
      "!",
    );

    await assertRejects(
      () => {
        return syncReplicaAndFsDir({
          dirPath: TEST_DIR,
          allowDirtyDirWithoutManifest: true,
          keypair: keypairA,
          replica,
        });
      },
      EarthstarError,
      `invalid path`,
      "throws when trying to write an invalid path (attachment variant)",
    );

    await replica.close(true);
  });

  await emptyDir(TEST_DIR);

  // Throws if a file is too big
  await test.step("throws when text files are too big", async () => {
    await Deno.writeTextFile(
      join(TEST_DIR, "big"),
      BIG_LOREM_IPSUM,
    );

    const replica = makeReplica(TEST_SHARE, shareKeypair.secret);

    await assertRejects(
      () => {
        return syncReplicaAndFsDir({
          dirPath: TEST_DIR,
          allowDirtyDirWithoutManifest: true,
          keypair: keypairA,
          replica,
        });
      },
      EarthstarError,
      `File too big for the es.5 format's text field`,
      "throws because big.jpg is too big",
    );

    await replica.close(true);
  });

  await emptyDir(TEST_DIR);

  // Writes from fs -> replica
  await test.step("writes text files from the fs -> replica", async () => {
    await Deno.writeTextFile(
      join(TEST_DIR, "text"),
      "A",
    );

    await ensureDir(join(TEST_DIR, "sub"));

    await Deno.writeTextFile(
      join(TEST_DIR, "sub", "text"),
      "B",
    );

    const replica = makeReplica(TEST_SHARE, shareKeypair.secret);

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica,
    });

    const textDoc = await replica.getLatestDocAtPath("/text");

    assert(textDoc);
    assertEquals(textDoc?.text, "A", "Content of /text is as expected");

    const subTextDoc = await replica.getLatestDocAtPath("/sub/text");

    assert(subTextDoc);
    assertEquals(
      subTextDoc?.text,
      "B",
      "Content of /sub/text is as expected",
    );

    // Attachment variant

    await Deno.writeTextFile(
      join(TEST_DIR, "attachment.txt"),
      "C",
    );

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica,
    });

    const attachmentDoc = await replica.getLatestDocAtPath("/attachment.txt");

    assert(attachmentDoc);
    assertEquals(
      attachmentDoc?.text,
      "Document generated by filesystem sync.",
      "Content of /attachment.txt is as expected",
    );

    const attachment = await replica.getAttachment(attachmentDoc);

    assert(attachment);
    assert(!isErr(attachment));
    assertEquals(new TextDecoder().decode(await attachment.bytes()), "C");

    await replica.close(true);
  });

  await emptyDir(TEST_DIR);

  // Writes docs from replica -> fs
  await test.step("writes files from the replica -> fs", async () => {
    const replica = makeReplica(TEST_SHARE, shareKeypair.secret);

    await replica.set(keypairB, {
      text: "A",
      path: "/text",
    });

    await replica.set(keypairB, {
      text: "B",
      path: "/sub/text",
    });

    await replica.set(keypairA, {
      text: "A short message",
      path: "/message.txt",
      attachment: new TextEncoder().encode("Greetings from abroad."),
    });

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica,
    });

    const textContents = await Deno.readTextFile(join(TEST_DIR, "text"));
    assertEquals(textContents, "A", "Content of /text is as expected");

    const subTextContents = await Deno.readTextFile(
      join(TEST_DIR, "sub", "text"),
    );
    assertEquals(
      subTextContents,
      "B",
      "Content of /sub/text is as expected",
    );

    const attachmentContents = await Deno.readTextFile(
      join(TEST_DIR, "message.txt"),
    );

    assertEquals(
      attachmentContents,
      "Greetings from abroad.",
      "Content of /message.txt is as expected",
    );

    await replica.close(true);
  });

  await emptyDir(TEST_DIR);

  // Deletes files from the FS we'd expect it to.
  await test.step("wiped docs on replica -> deleted file on the fs", async () => {
    const replica = makeReplica(TEST_SHARE, shareKeypair.secret);

    await replica.set(keypairB, {
      text: "A",
      path: "/to-delete",
    });

    await replica.set(keypairB, {
      text: "A",
      path: "/sub/to-delete",
    });

    await replica.set(keypairB, {
      text: "A",
      path: "/sub2/to-delete",
    });

    await replica.set(keypairB, {
      text: "A",
      path: "/sub2/dont-delete",
    });

    await replica.set(keypairB, {
      text: "A farewell message",
      path: "/delete.txt",
      attachment: new TextEncoder().encode("Goodbye."),
    });

    await replica.set(keypairB, {
      text: "A message to keep",
      path: "/keep.txt",
      attachment: new TextEncoder().encode("Here's my number."),
    });

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica,
    });

    await replica.wipeDocAtPath(keypairB, "/to-delete");

    await Deno.remove(join(TEST_DIR, "sub", "to-delete"));

    await replica.wipeDocAtPath(keypairB, "/sub2/to-delete");

    await replica.wipeDocAtPath(keypairB, "/delete.txt");

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica,
    });

    await assertRejects(
      () => {
        return Deno.stat(join(TEST_DIR, "to-delete"));
      },
      Deno.errors.NotFound,
      undefined,
      "stat /to-delete",
    );

    await assertRejects(
      () => {
        return Deno.stat(join(TEST_DIR, "sub", "to-delete"));
      },
      Deno.errors.NotFound,
      undefined,
      "stat /sub/to-delete",
    );

    await assertRejects(
      () => {
        return Deno.stat(join(TEST_DIR, "sub"));
      },
      Deno.errors.NotFound,
      undefined,
      `stat /sub/ dir`,
    );

    await assertRejects(
      () => {
        return Deno.stat(join(TEST_DIR, "sub2", "to-delete"));
      },
      Deno.errors.NotFound,
      undefined,
      "stat /sub2/to-delete",
    );

    assert(await Deno.stat(join(TEST_DIR, "sub2", "dont-delete")));

    await assertRejects(
      () => {
        return Deno.stat(join(TEST_DIR, "delete.txt"));
      },
      Deno.errors.NotFound,
      undefined,
      "stat delete.txt",
    );

    await replica.close(true);
  });

  await emptyDir(TEST_DIR);

  // Wipes docs from the replica we'd expect it to.
  await test.step("deleted files on the fs -> wiped doc on replica", async () => {
    const replica = makeReplica(TEST_SHARE, shareKeypair.secret);

    await replica.set(keypairB, {
      text: "A",
      path: "/to-delete",
    });

    await replica.set(keypairB, {
      text: "Something to delete",
      path: "/message.txt",
      attachment: new TextEncoder().encode("Something surprising."),
    });

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica,
    });

    await Deno.remove(join(TEST_DIR, "to-delete"));
    await Deno.remove(join(TEST_DIR, "message.txt"));

    await assertRejects(
      () => {
        return Deno.stat(join(TEST_DIR, "to-delete"));
      },
      Deno.errors.NotFound,
      undefined,
      "/to-delete is gone from the fs",
    );

    await assertRejects(
      () => {
        return Deno.stat(join(TEST_DIR, "message.txt"));
      },
      Deno.errors.NotFound,
      undefined,
      "/message.txt is gone from the fs",
    );

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica,
    });

    const toDeleteDoc = await replica.getLatestDocAtPath("/to-delete");

    assertEquals(toDeleteDoc?.text, "", "/to-delete was wiped");

    const toDeleteAttachmentDoc = await replica.getLatestDocAtPath(
      "/message.txt",
    );

    assertEquals(toDeleteAttachmentDoc?.text, "", "/message.txt was wiped");

    // Does not delete a doc which was written to replica-side since last sync
    await replica.set(keypairB, {
      text: "A",
      path: "/will-return",
    });

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica,
    });

    await Deno.remove(join(TEST_DIR, "will-return"));

    await replica.set(keypairB, {
      text: "B",
      path: "/will-return",
    });

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica,
    });

    const returnedContents = await Deno.readTextFile(
      join(TEST_DIR, "will-return"),
    );

    assertEquals(returnedContents, "B");

    // Deletes docs which have expired replica-side

    await replica.set(keypairB, {
      text: "!!!",
      path: "/!ephemeral",
      deleteAfter: (Date.now() * 1000) + (1000 * 1000),
    });

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica,
    });

    const ephemeralContents = await Deno.readTextFile(
      join(TEST_DIR, "!ephemeral"),
    );

    assertEquals(ephemeralContents, "!!!");

    await sleep(1500);

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica,
    });

    await assertRejects(
      () => {
        return Deno.readTextFile(join(TEST_DIR, "!ephemeral"));
      },
      Deno.errors.NotFound,
      undefined,
      "reading ephemeral doc which should have been deleted.",
    );

    // Deletes ephemeral files without corresponding doc

    await Deno.writeTextFile(join(TEST_DIR, "!ephemeral2"), "!!!");

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica,
    });

    const ephemeralDoc = await replica.getLatestDocAtPath("/!ephemeral2");
    assertEquals(
      ephemeralDoc,
      undefined,
      "replica does not have ephemeral doc defined from fs",
    );

    await assertRejects(
      () => {
        return Deno.readTextFile(join(TEST_DIR, "!ephemeral2"));
      },
      Deno.errors.NotFound,
      undefined,
      "ephemeral doc defined on fs-side is gone",
    );

    await replica.close(true);
  });

  await emptyDir(TEST_DIR);

  await test.step("stores older versions of docs from the fs", async () => {
    const replica = makeReplica(TEST_SHARE, shareKeypair.secret);

    await Deno.writeTextFile(
      join(TEST_DIR, "wiki"),
      "B",
    );

    await replica.set(keypairA, {
      text: "A",
      path: "/wiki",
    });

    await syncReplicaAndFsDir({
      allowDirtyDirWithoutManifest: true,
      dirPath: TEST_DIR,
      keypair: keypairB,
      replica: replica,
    });

    const versions = await replica.getAllDocsAtPath("/wiki");

    assertEquals(versions.length, 2, "There are two versions of wiki.txt");

    const contents = versions.map(({ text }) => text).sort();

    assertEquals(contents, ["A", "B"], "contents of versions are as expected");

    await replica.close(true);
  });

  await emptyDir(TEST_DIR);
});

const BIG_LOREM_IPSUM =
  `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nam eget nunc ac tellus aliquet fermentum. Sed ultrices dolor ac ligula fermentum, dapibus luctus odio aliquet. Donec ultrices sit amet urna et posuere. Nulla turpis lorem, vehicula eu laoreet ac, maximus tempus urna. Vivamus eu nulla hendrerit, convallis lorem condimentum, gravida mauris. In id libero mattis, viverra lorem a, aliquet dui. Donec accumsan tortor eu neque sodales euismod. Etiam lacinia fermentum enim in posuere. Nulla porta metus vel eros porttitor vehicula. Aenean aliquam lacus nec mauris porttitor porta. Ut id bibendum urna, eget tincidunt justo. Donec ac eros eu ligula vehicula tincidunt.

Nullam varius urna at augue rhoncus, vitae hendrerit ex luctus. Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Cras ut fringilla est. Suspendisse pellentesque turpis magna, eu pretium lorem congue eu. Suspendisse potenti. Orci varius natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Duis facilisis sapien et elit volutpat, a elementum magna varius. Suspendisse a augue sed nisi posuere iaculis. Aenean pharetra ante eget ultrices interdum. Donec luctus eros vel lorem pulvinar, a laoreet diam feugiat.

Vivamus elementum gravida nulla a eleifend. Proin tristique justo a elit tincidunt, quis dictum ipsum tempus. Sed sagittis erat nec mollis vehicula. Pellentesque fermentum, dui sit amet eleifend dignissim, purus lacus mattis quam, at aliquam odio est eget lacus. In feugiat nisl eu felis fermentum sagittis. Cras ut rutrum nulla. Aliquam arcu metus, ultrices et efficitur accumsan, volutpat non eros. Aenean ac augue vel mauris placerat fermentum. Duis placerat id turpis id commodo.

Curabitur sit amet congue arcu, vitae suscipit sem. Sed tristique purus at laoreet facilisis. Sed efficitur tellus vitae ultrices viverra. Curabitur accumsan, tortor vel auctor semper, lorem nibh varius dui, in sollicitudin nisl justo id arcu. Nullam id ipsum ut magna condimentum facilisis et vel ante. Curabitur convallis, risus sit amet vehicula blandit, enim nibh sodales metus, ac gravida magna leo vitae felis. Ut urna dui, pulvinar sed dictum vitae, posuere non eros. Aenean eleifend lorem porta, hendrerit ipsum nec, maximus turpis. Fusce enim leo, posuere quis dolor eu, tincidunt hendrerit odio. Nam ultricies rhoncus arcu eget semper. Duis vitae mauris tincidunt, rutrum mauris at, tempor est.

Fusce quis quam non magna viverra aliquam ac et erat. Curabitur a dui faucibus, congue purus at, mattis dolor. Praesent mattis purus id tellus pulvinar fringilla. Fusce a enim ipsum. Donec non molestie metus, non ullamcorper nisi. Etiam ut nibh id lorem vestibulum venenatis. Mauris a est nulla. Quisque malesuada sollicitudin diam vitae malesuada. Mauris elit quam, mattis in neque ut, consectetur volutpat risus.

Mauris auctor dictum ultricies. In ultricies dolor ex, sit amet imperdiet metus tristique non. Ut sollicitudin ut nulla eu convallis. Phasellus mollis lectus felis, ut iaculis neque volutpat sit amet. Phasellus ultricies commodo ex, vel hendrerit felis ullamcorper at. Fusce sed varius turpis, et bibendum turpis. Quisque fringilla justo ut leo tempor consequat. Donec ultricies vehicula sem, eu dignissim nunc venenatis mattis. Aliquam in auctor ante. Ut lobortis hendrerit est, et pellentesque justo commodo nec. Vestibulum consectetur sed tellus ut finibus. Proin mattis risus a elementum mattis. Suspendisse potenti.

Integer consectetur nec leo sit amet sodales. Nullam tincidunt fringilla nibh ac fermentum. Mauris fringilla ligula ac finibus eleifend. Nunc lobortis lorem lorem, in porta ipsum sollicitudin quis. Duis porttitor purus diam, at auctor orci cursus at. Fusce dignissim a enim et euismod. Cras non ullamcorper nisi, vel sagittis lorem. Maecenas hendrerit maximus turpis in accumsan. Curabitur ut urna quis orci egestas ultrices fermentum at enim. Cras nec massa felis.

Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos. Integer orci nibh, ullamcorper ac mauris et, convallis pharetra justo. Nullam vel justo sodales ex semper accumsan ut consequat est. Nunc vestibulum, mi egestas posuere convallis, tortor dui imperdiet lectus, in placerat quam elit ut turpis. Phasellus condimentum quam in ex cursus suscipit. Vestibulum egestas vitae ex laoreet suscipit. Nulla fringilla, urna vel consequat lacinia, sapien sapien tincidunt nisi, a consectetur libero ex at ipsum. Nunc accumsan vulputate nulla vel dictum. Etiam maximus urna at leo lobortis facilisis. Maecenas dictum tristique sapien, at congue dui pellentesque et.

Mauris feugiat leo vitae massa tristique ornare. Duis vestibulum aliquam finibus. Mauris at velit nec leo pulvinar convallis. Integer egestas enim ut tellus posuere tempus. Nam eget elementum velit. Proin ut faucibus neque, vel tincidunt odio. Cras fringilla nisi sed nisi porta, suscipit volutpat orci efficitur. Cras et nibh sed magna commodo vehicula. Etiam convallis efficitur sem, in aliquam lacus pulvinar at. Morbi tincidunt dolor ut mauris facilisis lobortis. Nulla vestibulum dolor nec varius consequat.

Vestibulum viverra vestibulum augue ac euismod. Fusce cursus, ante nec scelerisque porta, tellus lectus varius diam, in sollicitudin tortor odio nec sapien. Donec eu mauris lorem. Cras nisl nibh, hendrerit vel augue non, vulputate rhoncus urna. Etiam vestibulum, nisi et hendrerit eleifend, lorem nisl blandit lacus, a tincidunt nisl lectus non mi. Donec sollicitudin eu nisi condimentum pretium. Sed ut sodales enim. Praesent ac vehicula enim. Vivamus viverra aliquam augue, non imperdiet leo varius eu. Praesent hendrerit purus in hendrerit lacinia. Sed in dapibus sapien.

Vestibulum ex est, venenatis sit amet convallis ultricies, viverra ut nisl. Ut viverra sodales ligula a fermentum. Fusce condimentum tellus vitae leo ultrices, id elementum lectus aliquam. Ut posuere tincidunt molestie. Proin fringilla nibh nisl, ac aliquam odio sodales quis. Fusce sodales, urna vitae faucibus aliquet, libero nibh commodo tortor, nec pretium nisi mauris nec orci. Cras convallis arcu ac purus varius, id euismod odio ullamcorper. Nam ligula erat, venenatis eget enim consequat, faucibus lacinia lacus. Maecenas fermentum a leo eu ornare.

Duis eu odio sed diam consectetur tristique non aliquet metus. Sed ac est consectetur, porttitor augue eu, venenatis massa. Nulla libero urna, varius sodales lobortis at, rhoncus ut diam. Suspendisse potenti. In hac habitasse platea dictumst. Praesent tristique rhoncus elit, ac lobortis justo interdum ac. Class aptent taciti sociosqu ad litora torquent per conubia nostra, per inceptos himenaeos. Suspendisse potenti. Donec quis auctor mi. Vestibulum vulputate aliquet luctus. Vivamus eu mi eros. Curabitur in risus quis justo interdum tincidunt eget eget metus.

Cras a felis orci. Nunc nec auctor risus. Nullam at dui sed justo consequat euismod. Nunc velit dolor, sollicitudin fringilla interdum non, lacinia at sem. Mauris tempus felis ullamcorper dictum ullamcorper. Aliquam pulvinar quam eros, nec ultricies est porta volutpat. Fusce finibus ut mauris non tempus. Mauris sit amet tellus id metus hendrerit tincidunt. Ut lorem neque, dignissim nec ornare at, ultricies sit amet urna. Sed quis ipsum diam. Mauris eget est vel nulla malesuada vestibulum. Quisque porta, dui lobortis pellentesque consectetur, felis massa accumsan est, vel molestie mauris ex at odio. Donec aliquam eros turpis, tristique lobortis risus pulvinar in. Proin eget blandit eros.

Vestibulum eu urna non nisl placerat pulvinar vitae id felis. Aenean a urna in metus ornare semper consectetur ut velit. Fusce porta, tortor et varius aliquet, dolor velit viverra purus, a ultricies dolor nibh at nibh. Nullam ut tristique diam. In hac habitasse platea dictumst. Suspendisse in purus dolor. Proin facilisis, mi eget aliquam maximus, eros libero porttitor justo, quis tincidunt ex dui et odio. Curabitur semper quis risus ut sodales. Maecenas euismod accumsan sodales. Maecenas in pellentesque nunc. Sed sit amet lobortis sem. Aliquam tempus enim tempor est sodales sed.`;
