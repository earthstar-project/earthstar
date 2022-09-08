import { emptyDir } from "https://deno.land/std@0.154.0/fs/empty_dir.ts";
import { ensureDir } from "https://deno.land/std@0.154.0/fs/ensure_dir.ts";
import { join } from "https://deno.land/std@0.154.0/path/mod.ts";
import { MANIFEST_FILE_NAME } from "../../sync-fs/constants.ts";
import { reconcileManifestWithDirContents } from "../../sync-fs/sync-fs.ts";
import { FileInfoEntry, SyncFsManifest } from "../../sync-fs/sync-fs-types.ts";
import { isAbsenceEntry } from "../../sync-fs/util.ts";
import { Crypto } from "../../crypto/crypto.ts";
import { assert, assertEquals, assertNotEquals } from "../asserts.ts";

const TEST_DIR = "src/test/fs-sync/dirs/reconcile_manifest";
const TEST_SHARE = "+test.a123";

Deno.test("reconcileManifestWithDirContents", async (test) => {
  await ensureDir(TEST_DIR);
  await emptyDir(TEST_DIR);

  await test.step("From an empty dir.", async () => {
    const manifest = await reconcileManifestWithDirContents(
      TEST_DIR,
      TEST_SHARE,
    );
    assert(Object.keys(manifest.entries).length === 0);
  });

  await emptyDir(TEST_DIR);

  // Check that the manifest has an entry for each file
  await test.step("From initial reconciliation (with no manifest)", async () => {
    // Write a simple file structure.
    await writeSampleDirContents(TEST_DIR);

    const manifest = await reconcileManifestWithDirContents(
      TEST_DIR,
      TEST_SHARE,
    );

    assertEquals(
      Object.keys(manifest.entries).sort(),
      [
        "/a",
        "/b",
        "/c",
        "/q/r.txt",
        "/q/s.txt",
        "/q/t.txt",
        "/w/x",
        "/w/y",
        "/w/z",
      ],
      "Manifest contains an entry for each path.",
    );

    await writeManifest(TEST_DIR, manifest);
  });

  // Check that the manifest adds an absence entry after a file is deleted.
  await test.step("After removing a file", async () => {
    await Deno.remove(join(TEST_DIR, "b"));
    const { entries, share } = await reconcileManifestWithDirContents(
      TEST_DIR,
      TEST_SHARE,
    );

    assertEquals(share, TEST_SHARE, "Manifest has correct share name");

    assertEquals(
      Object.keys(entries).sort(),
      [
        "/a",
        "/b",
        "/c",
        "/q/r.txt",
        "/q/s.txt",
        "/q/t.txt",
        "/w/x",
        "/w/y",
        "/w/z",
      ],
      "Manifest contains an entry for each path.",
    );

    assert(isAbsenceEntry(entries["/b"]), "/b is an absence entry");
    assert(
      !isAbsenceEntry(entries["/a"]),
      "/a is NOT an absence entry",
    );
    assert(
      !isAbsenceEntry(entries["/c"]),
      "/ is NOT an absence entry",
    );
    assert(
      !isAbsenceEntry(entries["/w/x"]),
      "/w/x is NOT an absence entry",
    );
    assert(
      !isAbsenceEntry(entries["/w/y"]),
      "/w/y is NOT an absence entry",
    );
    assert(
      !isAbsenceEntry(entries["/w/z"]),
      "/w/z is NOT an absence entry",
    );
    // Attachments
    assert(
      !isAbsenceEntry(entries["/q/r.txt"]),
      "/q/r.txt is NOT an absence entry",
    );
    assert(
      !isAbsenceEntry(entries["/q/s.txt"]),
      "/q/s.txt is NOT an absence entry",
    );
    assert(
      !isAbsenceEntry(entries["/q/t.txt"]),
      "/q/t.txt is NOT an absence entry",
    );
  });

  let prevZEntry: FileInfoEntry | null = null;

  await test.step("After re-adding a file", async () => {
    await Deno.writeTextFile(join(TEST_DIR, "b"), "I'm back baby");

    const { entries, share } = await reconcileManifestWithDirContents(
      TEST_DIR,
      TEST_SHARE,
    );

    assertEquals(share, TEST_SHARE, "Manifest has correct share name");

    assertEquals(
      Object.keys(entries).sort(),
      [
        "/a",
        "/b",
        "/c",
        "/q/r.txt",
        "/q/s.txt",
        "/q/t.txt",
        "/w/x",
        "/w/y",
        "/w/z",
      ],
      "Manifest contains an entry for each path.",
    );

    assert(
      !isAbsenceEntry(entries["/b"]),
      "/b is NOT an absence entry",
    );
    assert(
      !isAbsenceEntry(entries["/a"]),
      "/a is NOT an absence entry",
    );

    assert(
      !isAbsenceEntry(entries["/c"]),
      "/ is NOT an absence entry",
    );
    assert(
      !isAbsenceEntry(entries["/w/x"]),
      "/w/x is NOT an absence entry",
    );
    assert(
      !isAbsenceEntry(entries["/w/y"]),
      "/w/y is NOT an absence entry",
    );
    assert(
      !isAbsenceEntry(entries["/w/z"]),
      "/w/z is NOT an absence entry",
    );
    // Attachments
    assert(
      !isAbsenceEntry(entries["/q/r.txt"]),
      "/q/r.txt is NOT an absence entry",
    );
    assert(
      !isAbsenceEntry(entries["/q/s.txt"]),
      "/q/s.txt is NOT an absence entry",
    );
    assert(
      !isAbsenceEntry(entries["/q/t.txt"]),
      "/q/t.txt is NOT an absence entry",
    );

    // We'll remember that for the next test.
    prevZEntry = entries["/w/z"];
  });

  await test.step("After updating a file", async () => {
    await Deno.writeTextFile(join(TEST_DIR, "w", "z"), "Updated!");

    const { entries, share } = await reconcileManifestWithDirContents(
      TEST_DIR,
      TEST_SHARE,
    );

    assertEquals(share, TEST_SHARE, "Manifest has correct share name");

    assertEquals(
      Object.keys(entries).sort(),
      [
        "/a",
        "/b",
        "/c",
        "/q/r.txt",
        "/q/s.txt",
        "/q/t.txt",
        "/w/x",
        "/w/y",
        "/w/z",
      ],
      "Manifest contains an entry for each path.",
    );

    assert(
      !isAbsenceEntry(entries["/w/z"]),
      "/w/z is NOT an absence entry",
    );

    assertNotEquals(
      prevZEntry,
      entries["/w/z"],
      "Entry for /w/z has changed",
    );
  });

  await test.step("Generates the right hashes and sizes", async () => {
    const { entries } = await reconcileManifestWithDirContents(
      TEST_DIR,
      TEST_SHARE,
    );

    assert(!isAbsenceEntry(entries["/a"]));

    assertEquals(
      entries["/a"].exposedContentSize,
      6,
      "Doc with no attachment uses size of text",
    );

    assertEquals(
      entries["/a"].exposedContentHash,
      await Crypto.sha256base32("Hello!"),
      "Doc with no attachment uses hash of text",
    );

    assert(!isAbsenceEntry(entries["/q/s.txt"]));

    assertEquals(
      entries["/q/s.txt"].exposedContentSize,
      3,
      "Doc with attachment uses size of text",
    );

    assertEquals(
      entries["/q/s.txt"].exposedContentHash,
      await Crypto.sha256base32("Hi!"),
      "Doc with attachment uses hash of text",
    );
  });

  await emptyDir(TEST_DIR);
});

export function writeManifest(dirPath: string, manifest: SyncFsManifest) {
  return Deno.writeTextFile(
    join(dirPath, MANIFEST_FILE_NAME),
    JSON.stringify(manifest),
  );
}

export async function writeSampleDirContents(dirPath: string) {
  await Deno.writeTextFile(join(dirPath, "a"), "Hello!");
  await Deno.writeTextFile(join(dirPath, "b"), "Hi!");
  await Deno.writeTextFile(join(dirPath, "c"), "Yo!");

  await ensureDir(join(dirPath, "w"));

  await Deno.writeTextFile(join(dirPath, "w", "x"), "Hello!");
  await Deno.writeTextFile(join(dirPath, "w", "y"), "Hi!");
  await Deno.writeTextFile(join(dirPath, "w", "z"), "Yo!");

  await ensureDir(join(dirPath, "q"));

  await Deno.writeTextFile(join(dirPath, "q", "r.txt"), "Hello!");
  await Deno.writeTextFile(join(dirPath, "q", "s.txt"), "Hi!");
  await Deno.writeTextFile(join(dirPath, "q", "t.txt"), "Yo!");
}
