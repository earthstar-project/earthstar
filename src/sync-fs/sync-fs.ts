import { encode } from "https://deno.land/std@0.126.0/encoding/base64.ts";
import { walk } from "https://deno.land/std@0.132.0/fs/mod.ts";
import {
  dirname,
  extname,
  join,
  relative,
  resolve,
} from "https://deno.land/std@0.132.0/path/mod.ts";
import { Crypto } from "../crypto/crypto.ts";
import { EarthstarError, isErr } from "../util/errors.ts";
import { FormatterEs4 } from "../formatters/formatter_es4.ts";
import {
  bytesExtensions,
  ES4_MAX_CONTENT_LENGTH,
  IGNORED_FILES,
  MANIFEST_FILE_NAME,
} from "./constants.ts";
import {
  FileInfoEntry,
  SyncFsManifest,
  SyncFsOptions,
} from "./sync-fs-types.ts";
import {
  dirBelongsToDifferentShare,
  getDirAssociatedShare,
  getTupleWinners,
  hasFilesButNoManifest,
  isAbsenceEntry,
  isFileInfoEntry,
  removeEmptyDir,
  writeDocToDir,
  writeEntryToReplica,
  writeManifest,
  zipByPath,
} from "./util.ts";

const textEncoder = new TextEncoder();

export async function reconcileManifestWithDirContents(
  fsDirPath: string,
  forShare: string,
): Promise<SyncFsManifest> {
  // Open up existing manifest.
  let manifest: SyncFsManifest = {
    share: forShare,
    entries: {},
  };

  try {
    const contents = await Deno.readTextFile(
      join(fsDirPath, MANIFEST_FILE_NAME),
    );

    manifest = JSON.parse(contents);
  } catch {
    // No manifest was present.
  }

  const fileEntries: Record<string, FileInfoEntry> = {};

  for await (const entry of walk(fsDirPath)) {
    if (IGNORED_FILES.includes(entry.name)) {
      continue;
    }

    if (entry.isFile) {
      const { path } = entry;

      const stat = await Deno.stat(path);
      const extension = extname(path);

      let contents = "";

      if (bytesExtensions.includes(extension)) {
        const fileContents = await Deno.readFile(path);
        contents = encode(fileContents);
      } else {
        contents = await Deno.readTextFile(path);
      }

      const hash = await Crypto.sha256base32(contents);
      const esPath = `/${relative(fsDirPath, path)}`;

      const record: FileInfoEntry = {
        dirName: dirname(path),
        path: esPath,
        abspath: resolve(path),
        size: stat.size,
        contentsSize: textEncoder.encode(contents).length,
        mtimeMs: stat.mtime?.getTime() || null,
        birthtimeMs: stat.birthtime?.getTime() || null,
        hash,
      };

      fileEntries[esPath] = record;
    }
  }

  const zipped = zipByPath(manifest.entries, fileEntries);

  const winners = getTupleWinners(zipped, (entryA, entryB) => {
    // This shouldn't happen but let's get it out the way.
    if (!entryA && !entryB) {
      return entryA as never;
    }

    // Manifest entry exists but file has disappeared.
    if (entryA && !entryB) {
      // If the entry is an absence entry, that's still valid.
      if (isAbsenceEntry(entryA)) {
        return entryA;
      }

      return {
        fileLastSeenMs: entryA.mtimeMs || 0,
        path: entryA.path,
      };
    }

    // No manifest entry, but a file present.
    if (!entryA && entryB) {
      return entryB;
    }

    // An existing manifest entry AND a file present.
    if (entryA && entryB) {
      // If entryA is absence entry, B should win.
      if (isAbsenceEntry(entryA)) {
        return entryB;
      }

      const latestA = Math.max(
        entryA.birthtimeMs || 0,
        entryA.mtimeMs || 0,
      );
      const latestB = Math.max(
        entryB.birthtimeMs || 0,
        entryB.mtimeMs || 0,
      );

      // If entry a has been modified more recently, it should win.
      // But if the content hasn't changed, we want to preserve the old timestamp.
      if (latestA > latestB || entryA.hash === entryB.hash) {
        return entryA;
      }

      return entryB;
    }

    // This should never happen.
    return entryA as never;
  });

  const nextManifest: SyncFsManifest = {
    share: forShare,
    entries: {},
  };

  for (const path in winners) {
    const entry = winners[path];

    // All paths accounted for, none of them should return null.
    if (!entry) {
      console.error("This shouldn't happen!");
      continue;
    }

    nextManifest.entries[path] = entry;
  }

  return nextManifest;
}

/*

Outline of how this function works:

1. The contents of the directory are compared with the manifest of that directory, and a new manifest is compiled.
2. The latest docs from the replica are retrieved before any operations are performed.
3. The entries from the manifest are iterated over, writing contents to the replica
4. The docs retrieved from the replica earlier are iterated over, writing contents to the file system.

*/

/**
 * Syncs an earthstar replica with a directory on the filesystem, representing Earthstar documents as files and vice versa. *Make sure you understand the changes this function could enact upon a given directory before using it, as it can delete files in certain circumstances.*
 * - Changes from the filesystem which are superseded by writes from the replica will still be synced to the replica as an older version of the document, provided they were authored by different identities.
 * - If a document has a certain extension (e.g. .jpg, .mp3), the syncer assumes the contents are base64 encoded when writing data to the filesystem.
 * - If a file has a path containing a `!` (i.e. an ephemeral path), *it will be deleted unless a correspending document is found in the replica*.
 */
export async function syncReplicaAndFsDir(
  opts: SyncFsOptions,
) {
  // Check if dir was every synced with a different share, throw if so.
  if (await dirBelongsToDifferentShare(opts.dirPath, opts.replica.share)) {
    const manifestShare = await getDirAssociatedShare(opts.dirPath);

    throw new EarthstarError(
      `Tried to sync a replica for ${opts.replica.share} with a directory which had been synced with ${manifestShare}`,
    );
  }

  // Check if dir has files but no manifest
  // and abort if a clean dir is required for no manifest.

  if (
    opts.allowDirtyDirWithoutManifest === false &&
    await hasFilesButNoManifest(opts.dirPath)
  ) {
    throw new EarthstarError(
      "Tried to sync a directory for the first time, but it was not empty.",
    );
  }

  // First reconcile any existing manifest with the contents of the directory.
  const reconciledManifest = await reconcileManifestWithDirContents(
    opts.dirPath,
    opts.replica.share,
  );

  const errors = [];

  for (const key in reconciledManifest.entries) {
    const entry = reconciledManifest.entries[key];

    if (!entry) {
      continue;
    }

    if (isAbsenceEntry(entry)) {
      // Keypair is allowed to write this path
      const canWriteToPath = FormatterEs4
        ._checkAuthorCanWriteToPath(opts.keypair.address, entry.path);

      if (isErr(canWriteToPath) && !opts.overwriteFilesAtOwnedPaths) {
        errors.push(canWriteToPath);
      }
    }

    if (isFileInfoEntry(entry)) {
      // Keypair is allowed to write this path
      const canWriteToPath = FormatterEs4
        ._checkAuthorCanWriteToPath(opts.keypair.address, entry.path);

      // Path is valid
      const pathIsValid = FormatterEs4._checkPathIsValid(
        entry.path,
      );

      // Size of file is not too big.
      const sizeIsOkay = entry.contentsSize <= ES4_MAX_CONTENT_LENGTH;

      if (isErr(canWriteToPath) && !opts.overwriteFilesAtOwnedPaths) {
        const correspondingDoc = await opts.replica.getLatestDocAtPath(
          entry.path,
        );

        if (!correspondingDoc) {
          errors.push(canWriteToPath);
        }

        // Only push this error if the corresponding doc's timestamp is older than the fileinfoentry's
        // AND if the hash is different.
        if (
          correspondingDoc && entry.mtimeMs &&
          (entry.mtimeMs * 1000 > correspondingDoc.timestamp &&
            correspondingDoc.contentHash !== entry.hash)
        ) {
          errors.push(canWriteToPath);
        }
      } else if (
        isErr(canWriteToPath) && opts.overwriteFilesAtOwnedPaths === true
      ) {
        delete reconciledManifest.entries[key];
      }

      if (isErr(pathIsValid)) {
        errors.push(pathIsValid);
      }

      if (!sizeIsOkay) {
        errors.push(
          new EarthstarError(
            `File too big for the es.4 format: ${entry.path}`,
          ),
        );
      }
    }
  }

  if (errors.length > 0) {
    throw errors[0];
  }

  for (const path in reconciledManifest.entries) {
    const entry = reconciledManifest.entries[path];

    if (entry.path.indexOf("!") !== -1 && isFileInfoEntry(entry)) {
      const correspondingEphemeralDoc = await opts.replica.getLatestDocAtPath(
        path,
      );

      if (
        !correspondingEphemeralDoc ||
        (correspondingEphemeralDoc && correspondingEphemeralDoc.deleteAfter &&
          Date.now() * 1000 > correspondingEphemeralDoc.deleteAfter)
      ) {
        await Deno.remove(entry.abspath);
        await removeEmptyDir(entry.dirName, opts.dirPath);
        continue;
      }
    }

    await writeEntryToReplica(entry, opts.replica, opts.keypair, opts.dirPath);
  }

  const latestDocs = await opts.replica.getLatestDocs();

  for (const doc of latestDocs) {
    // Make sure not to re-write any ephemeral docs to the filesystem.
    if (doc.deleteAfter && Date.now() * 1000 > doc.deleteAfter) {
      return;
    }

    await writeDocToDir(doc, opts.dirPath);
  }

  // Wipe any empty dirs
  try {
    for await (const entry of walk(opts.dirPath)) {
      if (entry.isDirectory) {
        await removeEmptyDir(entry.path, opts.dirPath);
      }
    }
  } catch {
    // Not sure why this fails sometimes...
  }

  const manifestAfterOps = await reconcileManifestWithDirContents(
    opts.dirPath,
    opts.replica.share,
  );

  await writeManifest(manifestAfterOps, opts.dirPath);
}
