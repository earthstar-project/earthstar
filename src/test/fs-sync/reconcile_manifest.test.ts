import { emptyDir, ensureDir } from "https://deno.land/std@0.132.0/fs/mod.ts";
import { join } from "https://deno.land/std@0.132.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.132.0/testing/asserts.ts";
import { MANIFEST_FILE_NAME } from "../../sync-fs/constants.ts";
import { reconcileManifestWithDirContents } from "../../sync-fs/sync-fs.ts";
import { FileInfoEntry, Manifest } from "../../sync-fs/sync-fs-types.ts";
import { isAbsenceEntry } from "../../sync-fs/util.ts";

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
      ["/a.txt", "/b.txt", "/c.txt", "/w/x.txt", "/w/y.txt", "/w/z.txt"],
      "Manifest contains an entry for each path.",
    );

    await writeManifest(TEST_DIR, manifest);
  });

  // Check that the manifest adds an absence entry after a file is deleted.
  await test.step("After removing a file", async () => {
    await Deno.remove(join(TEST_DIR, "b.txt"));
    const { entries, share } = await reconcileManifestWithDirContents(
      TEST_DIR,
      TEST_SHARE,
    );

    assertEquals(share, TEST_SHARE, "Manifest has correct share name");

    assertEquals(
      Object.keys(entries).sort(),
      ["/a.txt", "/b.txt", "/c.txt", "/w/x.txt", "/w/y.txt", "/w/z.txt"],
      "Manifest contains an entry for each path.",
    );

    assert(isAbsenceEntry(entries["/b.txt"]), "/b.txt is an absence entry");
    assert(
      !isAbsenceEntry(entries["/a.txt"]),
      "/a.txt is NOT an absence entry",
    );
    assert(
      !isAbsenceEntry(entries["/c.txt"]),
      "/.txt is NOT an absence entry",
    );
    assert(
      !isAbsenceEntry(entries["/w/x.txt"]),
      "/w/x.txt is NOT an absence entry",
    );
    assert(
      !isAbsenceEntry(entries["/w/y.txt"]),
      "/w/y.txt is NOT an absence entry",
    );
    assert(
      !isAbsenceEntry(entries["/w/z.txt"]),
      "/w/z.txt is NOT an absence entry",
    );
  });

  let prevZEntry: FileInfoEntry | null = null;

  await test.step("After re-adding a file", async () => {
    await Deno.writeTextFile(join(TEST_DIR, "b.txt"), "I'm back baby");

    const { entries, share } = await reconcileManifestWithDirContents(
      TEST_DIR,
      TEST_SHARE,
    );

    assertEquals(share, TEST_SHARE, "Manifest has correct share name");

    assertEquals(
      Object.keys(entries).sort(),
      ["/a.txt", "/b.txt", "/c.txt", "/w/x.txt", "/w/y.txt", "/w/z.txt"],
      "Manifest contains an entry for each path.",
    );

    assert(
      !isAbsenceEntry(entries["/b.txt"]),
      "/b.txt is NOT an absence entry",
    );
    assert(
      !isAbsenceEntry(entries["/a.txt"]),
      "/a.txt is NOT an absence entry",
    );

    assert(
      !isAbsenceEntry(entries["/c.txt"]),
      "/.txt is NOT an absence entry",
    );
    assert(
      !isAbsenceEntry(entries["/w/x.txt"]),
      "/w/x.txt is NOT an absence entry",
    );
    assert(
      !isAbsenceEntry(entries["/w/y.txt"]),
      "/w/y.txt is NOT an absence entry",
    );
    assert(
      !isAbsenceEntry(entries["/w/z.txt"]),
      "/w/z.txt is NOT an absence entry",
    );

    // We'll remember that for the next test.
    prevZEntry = entries["/w/z.txt"];
  });

  await test.step("After updating a file", async () => {
    await Deno.writeTextFile(join(TEST_DIR, "w", "z.txt"), "Updated!");

    const { entries, share } = await reconcileManifestWithDirContents(
      TEST_DIR,
      TEST_SHARE,
    );

    assertEquals(share, TEST_SHARE, "Manifest has correct share name");

    assertEquals(
      Object.keys(entries).sort(),
      ["/a.txt", "/b.txt", "/c.txt", "/w/x.txt", "/w/y.txt", "/w/z.txt"],
      "Manifest contains an entry for each path.",
    );

    assert(
      !isAbsenceEntry(entries["/w/z.txt"]),
      "/w/z.txt is NOT an absence entry",
    );

    assertNotEquals(
      prevZEntry,
      entries["/w/z.txt"],
      "Entry for /w/z.txt has changed",
    );
  });

  await emptyDir(TEST_DIR);
});

export function writeManifest(dirPath: string, manifest: Manifest) {
  return Deno.writeTextFile(
    join(dirPath, MANIFEST_FILE_NAME),
    JSON.stringify(manifest),
  );
}

export async function writeSampleDirContents(dirPath: string) {
  await Deno.writeTextFile(join(dirPath, "a.txt"), "Hello!");
  await Deno.writeTextFile(join(dirPath, "b.txt"), "Hi!");
  await Deno.writeTextFile(join(dirPath, "c.txt"), "Yo!");

  await ensureDir(join(dirPath, "w"));

  await Deno.writeTextFile(join(dirPath, "w", "x.txt"), "Hello!");
  await Deno.writeTextFile(join(dirPath, "w", "y.txt"), "Hi!");
  await Deno.writeTextFile(join(dirPath, "w", "z.txt"), "Yo!");
}
