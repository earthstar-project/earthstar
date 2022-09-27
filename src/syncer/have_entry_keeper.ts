import { QuerySourceEvent } from "../replica/replica-types.ts";
import { HaveEntry, HaveEntryKeeperMode } from "./syncer_types.ts";
import { BlockingBus } from "../streams/stream_utils.ts";
import { AuthorAddress, DocBase, Path, Timestamp } from "../util/doc-types.ts";
import { deferred, xxHash32 } from "../../deps.ts";

function internalEntryToHaveEntry(id: string, entry: {
  path: string;
  versions: Record<string, { author: AuthorAddress; timestamp: Timestamp }>;
}): HaveEntry {
  const existingVersions: Record<string, Timestamp> = {};

  for (const versionId in entry.versions) {
    existingVersions[versionId] = entry.versions[versionId]
      .timestamp as number;
  }

  return {
    id,
    versions: existingVersions,
  };
}

/** Processes documents to build a hashed ledger of `HaveEntry`s.*/
export class HaveEntryKeeper {
  /** Root entries (by path) mapped by hashed ID.*/
  private entriesById: Map<
    // This is the hashed ID of the path
    string,
    {
      path: Path;
      versions: Record<
        // This is the hashed ID of the path + author
        string,
        { author: AuthorAddress; timestamp: Timestamp }
      >;
    }
  > = new Map();
  /** Version entries (path + author) mapped by hashed ID */
  private versionsById: Map<
    // This is the hashed ID of the path + author
    string,
    {
      // This is the hashed ID of the entry (with path) this version belongs to
      entryId: string;
      version: { author: AuthorAddress; timestamp: Timestamp };
    }
  > = new Map();
  /** A promise for when all **existing** documents have been processed. */
  private ready = deferred();

  /** A bus the readable streams subscribe to for newly arrived docs */
  private liveEntryBus = new BlockingBus<HaveEntry>();

  /** Processes a stream of QuerySourceEvents into `HaveEntry`. */
  writable: WritableStream<QuerySourceEvent<DocBase<string>>>;
  /** A readable stream of `HaveEntry`. Only starts once the `HaveEntryKeeper is ready. */
  readable: ReadableStream<HaveEntry>;
  /** A readable stream of `HaveEntry` created from docs created DURING the lifetime of the HaveEntryKeeper. */
  onlyLiveReadable: ReadableStream<HaveEntry>;

  constructor(mode: HaveEntryKeeperMode) {
    const addDoc = this.addDoc.bind(this);
    const getEntries = this.getEntries.bind(this);

    const { ready, liveEntryBus } = this;

    this.writable = new WritableStream<QuerySourceEvent<DocBase<string>>>({
      write(querySourceEvent) {
        if (
          querySourceEvent.kind === "existing" ||
          querySourceEvent.kind === "success"
        ) {
          const entry = addDoc(querySourceEvent.doc);

          // A success event means this was a live ingestion.
          // The readable stream will be interested in that.
          if (querySourceEvent.kind === "success") {
            liveEntryBus.send(entry);
          }
        }

        if (querySourceEvent.kind === `processed_all_existing`) {
          ready.resolve();
        }
      },
      close() {
        ready.resolve();
      },
    });

    this.readable = new ReadableStream({
      start(controller) {
        liveEntryBus.on((entry) => {
          controller.enqueue(entry);
        });

        ready.then(() => {
          const entries = getEntries();

          for (const entry of entries) {
            controller.enqueue(entry);
          }

          if (mode === "existing") {
            controller.close();
          }
        });
      },
    });

    this.onlyLiveReadable = new ReadableStream({
      start(controller) {
        liveEntryBus.on((entry) => {
          controller.enqueue(entry);
        });
      },
    });
  }

  /** Add a document to the ledger of `HaveEntry`. May create a new entry, or modify an existing one. */
  addDoc(doc: DocBase<string>): HaveEntry {
    const encoder = new TextEncoder();

    const pathBytes = encoder.encode(doc.path);
    const versionBytes = encoder.encode(doc.path + doc.author);

    const entryId = xxHash32(pathBytes).toString(16);
    const versionId = xxHash32(versionBytes).toString(16);

    const existing = this.entriesById.get(entryId);

    const versionInfo = {
      author: doc.author,
      timestamp: doc.timestamp,
    };

    if (existing) {
      this.entriesById.set(entryId, {
        path: doc.path,
        versions: {
          ...existing.versions,
          [versionId]: versionInfo,
        },
      });
    } else {
      this.entriesById.set(entryId, {
        path: doc.path,
        versions: {
          [versionId]: versionInfo,
        },
      });
    }

    this.versionsById.set(versionId, { entryId, version: versionInfo });

    return internalEntryToHaveEntry(entryId, {
      path: doc.path,
      versions: {
        ...existing?.versions,
        [versionId]: versionInfo,
      },
    });
  }

  /** Get a HaveEntry by ID. If you pass a version ID, it'll return the HaveEntry that version belongs to. */
  getId(id: string): HaveEntry | undefined {
    let entryId = id;

    const maybeVersion = this.versionsById.get(id);

    if (maybeVersion) {
      entryId = maybeVersion.entryId;
    }

    const maybeEntry = this.entriesById.get(entryId);

    if (maybeEntry) {
      return internalEntryToHaveEntry(entryId, maybeEntry);
    }
  }

  /** Get the associated document path and versions for a given ID. Useful for checking if an incoming doc matches the ID. */
  getPathAndVersionsForId(
    id: string,
  ): { path: Path; versions: Record<string, AuthorAddress> } | undefined {
    const entry = this.entriesById.get(id);

    // This feels a bit stupid. Maybe there's a better way to store entries + versions so that we don't need to reconstruct this way...
    if (entry) {
      const versions: Record<string, AuthorAddress> = {};

      for (const versionId in entry.versions) {
        versions[versionId] = entry.versions[versionId].author;
      }

      return { path: entry.path, versions };
    }

    const maybeVersion = this.versionsById.get(id);

    if (!maybeVersion) {
      return undefined;
    }

    const path = this.getPathAndVersionsForId(maybeVersion.entryId)?.path;

    if (!path) {
      console.error(
        "HaveEntryKeeper: A version of a HaveEntry claimed to belong to an Entry which could not be found.",
      );
      return undefined as never;
    }

    return {
      path,
      versions: {
        [id]: maybeVersion.version.author,
      },
    };
  }

  /** Get the root `HaveEntry` ID from one of its constituent versiod IDs. */
  getRootId(versionId: string): string | undefined {
    return this.versionsById.get(versionId)?.entryId;
  }

  /** Check if the ledger has an entry with a given ID. */
  hasEntryWithId(id: string): boolean {
    return this.entriesById.has(id) || this.versionsById.has(id);
  }

  /** Get all `HaveEntry` as an array. */
  getEntries(): HaveEntry[] {
    return Array.from(this.entriesById.entries()).map(([id, entry]) =>
      internalEntryToHaveEntry(id, entry)
    );
  }

  /** Return a hash representing the entire ledge of hashes. */
  getHash() {
    const entries = Array.from(this.entriesById.entries()).sort(
      ([aId], [bId]) => {
        return aId < bId ? -1 : 1;
      },
    ).map(([id, entry]) => {
      const versionStrings: string[] = [];

      for (const key in entry.versions) {
        const v = entry.versions[key];

        versionStrings.push(`${v.author}_${v.timestamp}`);
      }

      return `${id}:${versionStrings.join(",")}`;
    });
    const asString = entries.join(".");
    const encoder = new TextEncoder();
    const entriesBytes = encoder.encode(asString);

    return xxHash32(entriesBytes).toString(16);
  }

  isReady() {
    return this.ready;
  }
}
