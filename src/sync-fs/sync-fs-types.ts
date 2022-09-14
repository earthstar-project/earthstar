import { Es5Credentials } from "../formats/format_es5.ts";
import { Replica } from "../replica/replica.ts";

/**
 * Options for syncing a replica with a filesystem directory.
 * - `dirPath`: The filesystem path of the directory to be synced
 * - `replica`: The replica to be synced with the directory
 * - `keypair`: The keypair to be used to sign all writes derived from changes on the filesystem.
 * - `allowDirtyDirWithoutManifest`: Whether to allow syncing of a folder with pre-existing contents which has never been synced before.
 */
export type SyncFsOptions = {
  dirPath: string;
  replica: Replica;
  credentials: Es5Credentials;
  allowDirtyDirWithoutManifest: boolean;
  overwriteFilesAtOwnedPaths?: boolean;
};

export type SyncFsManifest = {
  share: string;
  entries: Record<string, FileInfoEntry | AbsenceEntry>;
};

export interface AbsenceEntry {
  path: string;
  fileLastSeenMs: number;
}

export interface FileInfoEntry {
  dirName: string;
  path: string;
  abspath: string;
  exposedContentSize: number;
  mtimeMs: number | null; // modified time (write)
  birthtimeMs: number | null; // created time
  exposedContentHash: string;
}
