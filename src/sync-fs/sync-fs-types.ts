import { Replica } from "../replica/replica.ts";
import { AuthorKeypair } from "../util/doc-types.ts";

/**
 * Options for syncing a replica with a filesystem directory.
 * - `dirPath`: The filesystem path of the directory to be synced
 * - `replica`: The replica to be synced with the directory
 * - `keypair`: The keypair to be used to sign all writes derived from changes on the filesystem.
 * - `allowDirtyDirWithoutManifest`: Whether to allow syncing of a folder with pre-existing contents which has never been synced before.
 */
export type SyncOptions = {
    dirPath: string;
    replica: Replica;
    keypair: AuthorKeypair;
    allowDirtyDirWithoutManifest: boolean;
};

export type Manifest = {
    share: string;
    entries: Record<string, FileInfoEntry | AbsenceEntry>;
};

export interface AbsenceEntry {
    path: string;
    fileLastSeenMs: number;
    noticedOnMs: number;
}

export interface FileInfoEntry {
    baseName: string;
    dirName: string;
    path: string;
    abspath: string;
    size: number;
    contentsSize: number;
    inode: number | null;
    atimeMs: number | null; // access time (read)
    mtimeMs: number | null; // modified time (write)
    birthtimeMs: number | null; // created time
    hash: string;
}
