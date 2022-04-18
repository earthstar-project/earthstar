import { emptyDir, ensureDir } from "https://deno.land/std@0.132.0/fs/mod.ts";
import { join } from "https://deno.land/std@0.132.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "https://deno.land/std@0.132.0/testing/asserts.ts";
import {
  ES4_MAX_CONTENT_LENGTH,
  MANIFEST_FILE_NAME,
} from "../../sync-fs/constants.ts";
import { syncReplicaAndFsDir } from "../../sync-fs/sync-fs.ts";
import { SyncFsManifest } from "../../sync-fs/sync-fs-types.ts";
import {
  decode,
  encode,
} from "https://deno.land/std@0.126.0/encoding/base64.ts";
import { Crypto } from "../../crypto/crypto.ts";
import { AuthorKeypair } from "../../util/doc-types.ts";
import { Replica } from "../../replica/replica.ts";
import { ReplicaDriverMemory } from "../../replica/replica-driver-memory.ts";
import { FormatValidatorEs4 } from "../../format-validators/format-validator-es4.ts";

const TEST_DIR = "src/test/fs-sync/dirs/sync_share_dir";
const TEST_SHARE = "+test.a123";

function makeReplica(address: string) {
  const driver = new ReplicaDriverMemory(address);
  return new Replica(
    address,
    FormatValidatorEs4,
    driver,
  );
}

Deno.test("syncShareAndDir", async (test) => {
  const keypairA = await Crypto.generateAuthorKeypair(
    "aaaa",
  ) as AuthorKeypair;
  const keypairB = await Crypto.generateAuthorKeypair(
    "bbbb",
  ) as AuthorKeypair;

  // Throws if the dir is dirty and there is no manifest + the option is on.

  await ensureDir(TEST_DIR);
  await emptyDir(TEST_DIR);
  await Deno.writeTextFile(join(TEST_DIR, "dirty.txt"), "heh");

  await test.step("can't sync a dirty folder without a manifest", async () => {
    await assertRejects(
      () => {
        return syncReplicaAndFsDir({
          dirPath: TEST_DIR,
          allowDirtyDirWithoutManifest: false,
          keypair: keypairA,
          replica: makeReplica(TEST_SHARE),
        });
      },
      undefined,
      "Tried to sync a directory for the first time, but it was not empty.",
      "throws on trying to sync dirty folder without a manifest",
    );

    assertEquals(
      await syncReplicaAndFsDir({
        allowDirtyDirWithoutManifest: true,
        dirPath: TEST_DIR,
        keypair: keypairA,
        replica: makeReplica(TEST_SHARE),
      }),
      undefined,
      "does not throw on trying to sync dirty folder without manifest when manually overridden",
    );
  });

  await emptyDir(TEST_DIR);

  // Throws if the replica address does not match the manifest address

  await test.step("can't sync a directory which was synced with another share", async () => {
    const otherReplica = makeReplica("+other.b123");

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: false,
      keypair: keypairA,
      replica: makeReplica(TEST_SHARE),
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
      undefined,
      "Tried to sync a replica for",
      "throws when trying to sync with a folder which had been synced with another share",
    );
  });

  await emptyDir(TEST_DIR);

  // Throws if you try to change a file at an owned path
  await test.step("throws when you try to change a file at someone else's owned path", async () => {
    const replica = makeReplica(TEST_SHARE);

    const ownedPath = join(TEST_DIR, `~${keypairB.address}`);

    await replica.set(keypairB, {
      path: `/~${keypairB.address}/mine.txt`,
      content: "Only Keypair B can change this",
      format: "es.4",
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
      join(ownedPath, "mine.txt"),
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
      undefined,
      `author ${keypairA.address} can't write to path`,
      "throws when trying to write a file at someone's else's own path",
    );

    replica.close(true);

    await emptyDir(TEST_DIR);

    const replica2 = makeReplica(TEST_SHARE);

    // Want to guard against a specific sequence of events.
    await replica2.set(keypairB, {
      path: `/~${keypairB.address}/special-case.txt`,
      content: "A",
      format: "es.4",
    });

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica: replica2,
    });

    await replica2.set(keypairB, {
      path: `/~${keypairB.address}/special-case.txt`,
      content: "B",
      format: "es.4",
    });

    const specialCasePath = join(
      TEST_DIR,
      `~${keypairB.address}`,
      `special-case.txt`,
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
  });

  await emptyDir(TEST_DIR);

  // Throws if you try to delete a file at an owned path
  await test.step("can forcibly overwrite files at owned paths", async () => {
    const ownedPath = join(TEST_DIR, `~${keypairB.address}/doc.txt`);

    await ensureDir(join(TEST_DIR, `~${keypairB.address}`));

    const replica = makeReplica(TEST_SHARE);

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
      undefined,
      `author ${keypairA.address} can't write to path`,
      "trying to modify a file at someone's else's owned path",
    );

    await replica.set(keypairB, {
      content: "Okay",
      format: "es.4",
      path: `/~${keypairB.address}/doc.txt`,
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
      undefined,
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
  });

  await emptyDir(TEST_DIR);

  // Throws if you try to delete a file at an owned path
  await test.step("throws when you try to delete a file at someone else's owned path", async () => {
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
          replica: makeReplica(TEST_SHARE),
        });
      },
      undefined,
      `author ${keypairA.address} can't write to path`,
      "throws when trying to delete a file at someone's else's own path",
    );
  });

  await emptyDir(TEST_DIR);

  // Throws if a file has an invalid path
  await test.step("throws when you write a file at an invalid path", async () => {
    const invalidPath = join(TEST_DIR, `/@invalid.png`);

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
          replica: makeReplica(TEST_SHARE),
        });
      },
      undefined,
      `invalid path`,
      "throws when trying to write an invalid path",
    );
  });

  await emptyDir(TEST_DIR);

  // Throws if a file is too big
  await test.step("throws when files are too big", async () => {
    const bytes = Uint8Array.from(Array(ES4_MAX_CONTENT_LENGTH + 100));
    await Deno.writeFile(join(TEST_DIR, "big.jpg"), bytes);

    await assertRejects(
      () => {
        return syncReplicaAndFsDir({
          dirPath: TEST_DIR,
          allowDirtyDirWithoutManifest: true,
          keypair: keypairA,
          replica: makeReplica(TEST_SHARE),
        });
      },
      undefined,
      `File too big for the es.4 format`,
      "throws because big.jpg is too big",
    );
  });

  await emptyDir(TEST_DIR);

  // Writes from fs -> replica
  await test.step("writes files from the fs -> replica", async () => {
    await Deno.writeTextFile(
      join(TEST_DIR, "text.txt"),
      "A",
    );

    await ensureDir(join(TEST_DIR, "sub"));

    await Deno.writeTextFile(
      join(TEST_DIR, "sub", "text.txt"),
      "B",
    );

    const replica = makeReplica(TEST_SHARE);

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica,
    });

    const textDoc = await replica.getLatestDocAtPath("/text.txt");

    assert(textDoc);
    assertEquals(textDoc?.content, "A", "Content of /text.txt is as expected");

    const subTextDoc = await replica.getLatestDocAtPath("/sub/text.txt");

    assert(subTextDoc);
    assertEquals(
      subTextDoc?.content,
      "B",
      "Content of /sub/text.txt is as expected",
    );
  });

  await emptyDir(TEST_DIR);

  // Writes docs from replica -> fs
  await test.step("writes files from the replica -> fs", async () => {
    const replica = makeReplica(TEST_SHARE);

    await replica.set(keypairB, {
      content: "A",
      path: "/text.txt",
      format: "es.4",
    });

    await replica.set(keypairB, {
      content: "B",
      path: "/sub/text.txt",
      format: "es.4",
    });

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica,
    });

    const textContents = await Deno.readTextFile(join(TEST_DIR, "text.txt"));
    assertEquals(textContents, "A", "Content of /text.txt is as expected");

    const subTextContents = await Deno.readTextFile(
      join(TEST_DIR, "sub", "text.txt"),
    );
    assertEquals(
      subTextContents,
      "B",
      "Content of /sub/text.txt is as expected",
    );
  });

  await emptyDir(TEST_DIR);

  // Deletes files from the FS we'd expect it to.
  await test.step("wiped docs on replica -> deleted file on the fs", async () => {
    const replica = makeReplica(TEST_SHARE);

    await replica.set(keypairB, {
      content: "A",
      path: "/to-delete.txt",
      format: "es.4",
    });

    await replica.set(keypairB, {
      content: "A",
      path: "/sub/to-delete.txt",
      format: "es.4",
    });

    await replica.set(keypairB, {
      content: "A",
      path: "/sub2/to-delete.txt",
      format: "es.4",
    });

    await replica.set(keypairB, {
      content: "A",
      path: "/sub2/dont-delete.txt",
      format: "es.4",
    });

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica,
    });

    await replica.set(keypairB, {
      content: "",
      path: "/to-delete.txt",
      format: "es.4",
    });

    await Deno.remove(join(TEST_DIR, "sub", "to-delete.txt"));

    await replica.set(keypairB, {
      content: "",
      path: "/sub2/to-delete.txt",
      format: "es.4",
    });
    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica,
    });

    await assertRejects(
      () => {
        return Deno.stat(join(TEST_DIR, "to-delete.txt"));
      },
      undefined,
      undefined,
      "stat /to-delete.txt",
    );

    await assertRejects(
      () => {
        return Deno.stat(join(TEST_DIR, "sub", "to-delete.txt"));
      },
      undefined,
      undefined,
      "stat /sub/to-delete.txt",
    );

    await assertRejects(
      () => {
        return Deno.stat(join(TEST_DIR, "sub"));
      },
      undefined,
      undefined,
      `stat /sub/ dir`,
    );

    await assertRejects(
      () => {
        return Deno.stat(join(TEST_DIR, "sub2", "to-delete.txt"));
      },
      undefined,
      undefined,
      "stat /sub2/to-delete.txt",
    );

    assert(await Deno.stat(join(TEST_DIR, "sub2", "dont-delete.txt")));
  });

  await emptyDir(TEST_DIR);

  // Wipes docs from the replica we'd expect it to.
  await test.step("deleted files on the fs -> wiped doc on replica", async () => {
    const replica = makeReplica(TEST_SHARE);

    await replica.set(keypairB, {
      content: "A",
      path: "/to-delete.txt",
      format: "es.4",
    });

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica,
    });

    await Deno.remove(join(TEST_DIR, "to-delete.txt"));

    await assertRejects(
      () => {
        return Deno.stat(join(TEST_DIR, "to-delete.txt"));
      },
      undefined,
      undefined,
      "/to-delete.txt is gone from the fs",
    );

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica,
    });

    const toDeleteDoc = await replica.getLatestDocAtPath("/to-delete.txt");

    assertEquals(toDeleteDoc?.content, "", "/to-delete.txt was wiped");

    // Does not delete a doc which was written to replica-side since last sync
    await replica.set(keypairB, {
      content: "A",
      path: "/will-return.txt",
      format: "es.4",
    });

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica,
    });

    await Deno.remove(join(TEST_DIR, "will-return.txt"));

    await replica.set(keypairB, {
      content: "B",
      path: "/will-return.txt",
      format: "es.4",
    });

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica,
    });

    const returnedContents = await Deno.readTextFile(
      join(TEST_DIR, "will-return.txt"),
    );

    assertEquals(returnedContents, "B");

    // Deletes docs which have expired replica-side

    await replica.set(keypairB, {
      content: "!!!",
      path: "/!ephemeral.txt",
      format: "es.4",
      deleteAfter: (Date.now() * 1000) + (1000 * 1000),
    });

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica,
    });

    const ephemeralContents = await Deno.readTextFile(
      join(TEST_DIR, "!ephemeral.txt"),
    );

    assertEquals(ephemeralContents, "!!!");

    await new Promise((resolve) => {
      setTimeout(resolve, 1500);
    });

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica,
    });

    await assertRejects(
      () => {
        return Deno.readTextFile(join(TEST_DIR, "!ephemeral.txt"));
      },
      undefined,
      undefined,
      "reading ephemeral doc which should have been deleted.",
    );

    // Deletes ephemeral files without corresponding doc

    await Deno.writeTextFile(join(TEST_DIR, "!ephemeral2.txt"), "!!!");

    await syncReplicaAndFsDir({
      dirPath: TEST_DIR,
      allowDirtyDirWithoutManifest: true,
      keypair: keypairA,
      replica,
    });

    const ephemeralDoc = await replica.getLatestDocAtPath("/!ephemeral2.txt");
    assertEquals(
      ephemeralDoc,
      undefined,
      "replica does not have ephemeral doc defined from fs",
    );

    await assertRejects(
      () => {
        return Deno.readTextFile(join(TEST_DIR, "!ephemeral,.txt"));
      },
      undefined,
      undefined,
      "ephemeral doc defined on fs-side is gone",
    );
  });

  await emptyDir(TEST_DIR);

  await test.step("stores older versions of docs from the fs", async () => {
    const replica = makeReplica(TEST_SHARE);

    await Deno.writeTextFile(
      join(TEST_DIR, "wiki.txt"),
      "B",
    );

    await replica.set(keypairA, {
      content: "A",
      path: "/wiki.txt",
      format: "es.4",
    });

    await syncReplicaAndFsDir({
      allowDirtyDirWithoutManifest: true,
      dirPath: TEST_DIR,
      keypair: keypairB,
      replica: replica,
    });

    const versions = await replica.getAllDocsAtPath("/wiki.txt");

    assertEquals(versions.length, 2, "There are two versions of wiki.txt");

    const contents = versions.map(({ content }) => content).sort();

    assertEquals(contents, ["A", "B"], "contents of versions are as expected");
  });

  await emptyDir(TEST_DIR);

  await test.step("converts certain file formats from base64 to binary", async () => {
    await Deno.writeTextFile(join(TEST_DIR, "pic.jpg"), "JPG_DATA");

    const replica = makeReplica(TEST_SHARE);

    await replica.set(keypairB, {
      path: "/pic.png",
      content: encode("PNG_DATA"),
      format: "es.4",
    });

    await syncReplicaAndFsDir({
      allowDirtyDirWithoutManifest: true,
      dirPath: TEST_DIR,
      keypair: keypairA,
      replica,
    });

    const jpgDoc = await replica.getLatestDocAtPath("/pic.jpg");

    assertNotEquals(
      "JPG_DATA",
      jpgDoc?.content,
      "data written to replica is not same as that in file",
    );

    const decoder = new TextDecoder();

    assertEquals(
      "JPG_DATA",
      decoder.decode(decode(jpgDoc?.content || "")),
      "doc content was encoded to base64",
    );

    const pngData = await Deno.readFile(join(TEST_DIR, "pic.png"));

    assertEquals(
      "PNG_DATA",
      decoder.decode(pngData),
      "file content was decoded from base64",
    );
  });

  await emptyDir(TEST_DIR);
});
