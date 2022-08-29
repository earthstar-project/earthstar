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
import { IGNORED_FILES, MANIFEST_FILE_NAME } from "./constants.ts";
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
import { AttachmentStreamInfo } from "../util/attachment_stream_info.ts";
import { FormatEs5 } from "../formats/format_es5.ts";

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

      let exposedContentSize = 0;
      let exposedContentHash = "";

      if (extension !== "") {
        const file = await Deno.open(path);

        const streamInfo = new AttachmentStreamInfo();

        await file.readable.pipeThrough(streamInfo).pipeTo(
          new WritableStream(),
        );

        exposedContentSize = await streamInfo.size;
        exposedContentHash = await streamInfo.hash;
      } else {
        const contents = await Deno.readTextFile(path);

        exposedContentHash = await Crypto.sha256base32(contents);
        exposedContentSize = textEncoder.encode(contents).byteLength;
      }

      const esPath = `/${relative(fsDirPath, path)}`;

      const record: FileInfoEntry = {
        dirName: dirname(path),
        path: esPath,
        abspath: resolve(path),
        exposedContentSize,
        mtimeMs: stat.mtime?.getTime() || null,
        birthtimeMs: stat.birthtime?.getTime() || null,
        exposedContentHash,
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
      if (
        latestA > latestB ||
        entryA.exposedContentHash === entryB.exposedContentHash
      ) {
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
3. The entries from the manifest
are iterated over, writing contents to the replica
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
      // New change is valid
      const result = await FormatEs5.generateDocument({
        keypair: opts.keypair,
        share: opts.replica.share,
        timestamp: Date.now() * 1000,
        input: {
          path: entry.path,
          text: "",
          format: "es.5",
        },
      });

      if (isErr(result)) {
        errors.push(result);
      } else {
        const isValidDoc = FormatEs5.checkDocumentIsValid(result.doc);

        if (isErr(isValidDoc) && !opts.overwriteFilesAtOwnedPaths) {
          errors.push(isValidDoc);
        }
      }
    }

    if (isFileInfoEntry(entry)) {
      const isAttachmentPath = extname(entry.abspath) !== "";

      const sizeIsOkay = isAttachmentPath || entry.exposedContentSize <= 8000;

      if (!sizeIsOkay) {
        errors.push(
          new EarthstarError(
            `File too big for the es.5 format's text field: ${entry.path}`,
          ),
        );
      }

      const text = isAttachmentPath
        ? (await opts.replica.getLatestDocAtPath(entry.path))?.text
        : "";

      // New change is valid
      const result = await FormatEs5.generateDocument({
        keypair: opts.keypair,
        share: opts.replica.share,
        timestamp: Date.now() * 1000,
        input: {
          path: entry.path,
          text: text || "",
          format: "es.5",
          ...(isAttachmentPath
            ? { attachment: (await (Deno.open(entry.abspath))).readable }
            : {}),
        },
      });

      if (isErr(result)) {
        errors.push(result);
      } else {
        const isValidDoc = FormatEs5.checkDocumentIsValid(result.doc);

        if (isErr(isValidDoc)) {
          const cantWrite = isValidDoc.message.includes("can't write to path");

          if (cantWrite && !opts.overwriteFilesAtOwnedPaths) {
            // Check if there's already a doc at this path
            const correspondingDoc = await opts.replica.getLatestDocAtPath(
              entry.path,
            );

            if (!correspondingDoc) {
              errors.push(isValidDoc);
            }

            // Only push this error if the corresponding doc's timestamp is older than the fileinfoentry's
            // AND if the hash is different.
            const hashToCompare = isAttachmentPath
              ? correspondingDoc?.attachmentHash
              : correspondingDoc?.textHash;

            if (
              correspondingDoc && entry.mtimeMs &&
              ((entry.mtimeMs * 1000 > correspondingDoc.timestamp) &&
                hashToCompare !== entry.exposedContentHash)
            ) {
              errors.push(isValidDoc);
            }
          } else if (
            cantWrite && opts.overwriteFilesAtOwnedPaths === true
          ) {
            delete reconciledManifest.entries[key];
          } else {
            errors.push(isValidDoc);
          }
        }
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

    try {
      await writeDocToDir(doc, opts.replica, opts.dirPath);
    } catch (err) {
      // Maybe we log something here...
    }
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
