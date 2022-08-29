import { MANIFEST_FILE_NAME } from "./constants.ts";
import {
  AbsenceEntry,
  FileInfoEntry,
  SyncFsManifest,
} from "./sync-fs-types.ts";
import {
  dirname,
  extname,
  join,
} from "https://deno.land/std@0.132.0/path/mod.ts";

import { ensureDir } from "https://deno.land/std@0.132.0/fs/mod.ts";
import { AuthorKeypair } from "../util/doc-types.ts";
import { Replica } from "../replica/replica.ts";
import { DocEs5 } from "../formats/format_es5.ts";
import { EarthstarError, isErr } from "../util/errors.ts";

export function isAbsenceEntry(
  o: AbsenceEntry | FileInfoEntry | DocEs5,
): o is AbsenceEntry {
  if ("fileLastSeenMs" in o) {
    return true;
  }

  return false;
}

export function isFileInfoEntry(
  o: AbsenceEntry | FileInfoEntry | DocEs5,
): o is FileInfoEntry {
  if ("abspath" in o) {
    return true;
  }

  return false;
}

export function isDoc(
  o: AbsenceEntry | FileInfoEntry | DocEs5,
): o is DocEs5 {
  if ("signature" in o) {
    return true;
  }

  return false;
}

export async function hasFilesButNoManifest(
  fsDirPath: string,
): Promise<boolean> {
  try {
    await Deno.stat(join(fsDirPath, MANIFEST_FILE_NAME));

    // SyncFsManifestis present.
    return false;
  } catch {
    // SyncFsManifestis not present.
    const items = [];
    for await (const dirEntry of Deno.readDir(fsDirPath)) {
      items.push(dirEntry);
    }

    // Return whether there are any files present.
    return items.length > 0;
  }
}

export async function dirBelongsToDifferentShare(
  dirPath: string,
  shareAddress: string,
) {
  try {
    const contents = await Deno.readTextFile(join(dirPath, MANIFEST_FILE_NAME));
    const manifest: SyncFsManifest = JSON.parse(contents);

    return manifest.share !== shareAddress;
  } catch {
    return false;
  }
}

export function writeManifest(manifest: SyncFsManifest, dirPath: string) {
  return Deno.writeTextFile(
    join(dirPath, MANIFEST_FILE_NAME),
    JSON.stringify(manifest),
  );
}

export async function getDirAssociatedShare(
  dirPath: string,
) {
  try {
    const contents = await Deno.readTextFile(join(dirPath, MANIFEST_FILE_NAME));
    const manifest: SyncFsManifest = JSON.parse(contents);

    return manifest.share;
  } catch {
    return undefined;
  }
}

/**
 * Take two sets of items organised by share path and zip them up into a record of tuples organised by paths.
 */
export function zipByPath<TypeA, TypeB>(
  aRecord: Record<string, TypeA>,
  bRecord: Record<string, TypeB>,
): Record<string, [TypeA | null, TypeB | null]> {
  const newRecord: Record<string, [TypeA | null, TypeB | null]> = {};

  for (const path in aRecord) {
    const value = aRecord[path];
    newRecord[path] = [value, null];
  }

  for (const path in bRecord) {
    const value = bRecord[path];

    const maybeExisting = newRecord[path];

    if (maybeExisting) {
      newRecord[path] = [maybeExisting[0], value];
      continue;
    }

    newRecord[path] = [null, value];
  }

  return newRecord;
}

export function getTupleWinners<TypeA, TypeB>(
  zippedRecord: Record<string, [TypeA | null, TypeB | null]>,
  determineWinner: (a: TypeA | null, b: TypeB | null) => TypeA | TypeB,
): Record<string, (TypeA | TypeB)> {
  const winners: Record<string, (TypeA | TypeB)> = {};

  for (const path in zippedRecord) {
    const [a, b] = zippedRecord[path];

    const winner = determineWinner(a, b);

    winners[path] = winner;
  }

  return winners;
}

export async function writeDocToDir(
  doc: DocEs5,
  replica: Replica,
  dir: string,
) {
  const pathToWrite = join(dir, doc.path);
  const enclosingDir = dirname(pathToWrite);
  const isAttachmentDoc = doc.attachmentHash !== undefined;

  if (doc.text.length === 0) {
    try {
      await Deno.remove(join(dir, doc.path));
      return removeEmptyDir(enclosingDir, dir);
    } catch {
      // Document is gone from the FS already.

      return;
    }
  }

  await ensureDir(enclosingDir);

  if (isAttachmentDoc) {
    const attachment = await replica.getAttachment(doc);

    if (isErr(attachment) || attachment === undefined) {
      throw new EarthstarError("Do not have attachment for document");
    }

    try {
      await Deno.truncate(pathToWrite);
    } catch {
      // It's fine if the pathToWrite isn't there yet
    }

    return (await attachment.stream()).pipeTo(
      new WritableStream({
        async write(chunk) {
          await Deno.writeFile(pathToWrite, chunk, {
            create: true,
            append: true,
          });
        },
      }),
    );
  }

  return Deno.writeTextFile(pathToWrite, doc.text);
}

export async function removeEmptyDir(dir: string, rootDir: string) {
  try {
    if (dir !== rootDir) {
      await Deno.remove(dir);
    }
  } catch {
    // There was something there. That's fine.
  }
}

export async function writeEntryToReplica(
  entry: FileInfoEntry | AbsenceEntry,
  replica: Replica,
  keypair: AuthorKeypair,
  rootDir: string,
) {
  const correspondingDoc = await replica.getLatestDocAtPath(entry.path);

  if (isAbsenceEntry(entry)) {
    if (
      correspondingDoc &&
      correspondingDoc.timestamp > entry.fileLastSeenMs * 1000
    ) {
      return;
    }

    return replica.wipeDocAtPath(keypair, entry.path);
  }

  const extension = extname(entry.path);
  const deleteAfter = correspondingDoc ? correspondingDoc.deleteAfter : null;

  if (correspondingDoc && deleteAfter && Date.now() * 1000 > deleteAfter) {
    await Deno.remove(entry.abspath);
    return removeEmptyDir(entry.dirName, rootDir);
  }

  // A doc without an attachment
  if (extension === "") {
    const text = await Deno.readTextFile(entry.abspath);
    const timestamp = entry.mtimeMs ? entry.mtimeMs * 1000 : undefined;

    return replica.set(keypair, {
      path: entry.path,
      text,
      timestamp,
      deleteAfter,
    });
  }

  const file = await Deno.open(entry.abspath);

  return replica.set(keypair, {
    path: entry.path,
    deleteAfter,
    attachment: file.readable,
  });
}
