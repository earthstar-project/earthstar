import { deferred, XXH64 } from "../../deps.ts";
import { FormatsArg } from "../formats/format_types.ts";
import { IPeer } from "../peer/peer-types.ts";
import { BlockingBus } from "../streams/stream_utils.ts";
import {
  AuthorAddress,
  Path,
  ShareAddress,
  Timestamp,
} from "../util/doc-types.ts";
import { EarthstarError } from "../util/errors.ts";
import { DocThumbnailTree } from "./doc_thumbnail_tree.ts";
import { PlumTree } from "./plum_tree.ts";
import { Syncer } from "./syncer.ts";
import { ISyncPartner } from "./syncer_types.ts";

/** A string starting with a share address, followed by formats separated by commas */
type DocThumbnailTreeKey = string;

/** A thumbnail pointing to a timestamp, path, and author address. */
type DocThumbnailHashToDocLookup = Record<
  string,
  [Timestamp, Path, AuthorAddress]
>;

export class SyncerManager {
  /** A map of syncer IDs to syncers  */
  private syncers = new Map<
    string,
    { description: string; syncer: Syncer<unknown, unknown> }
  >();

  private syncerEventBus = new BlockingBus<
    Map<
      string,
      { description: string; syncer: Syncer<unknown, unknown> }
    >
  >();

  peer: IPeer;

  constructor(peer: IPeer) {
    this.peer = peer;
  }

  addPartner<I, F>(
    partner: ISyncPartner<I>,
    description: string,
    formats?: FormatsArg<F>,
  ): Syncer<I, F> {
    // Add a new syncer with a given partner config.
    const syncer = new Syncer({
      manager: this,
      partner,
      formats,
    });

    this.syncers.set(syncer.id, { syncer, description });

    this.syncerEventBus.send(this.syncers);

    return syncer;
  }

  /** Returns a record of syncers with their given descriptions as keys. */
  getSyncers() {
    return this.syncers;
  }

  // INITIAL SYNC (range-based set reconciliation)

  /** DocThumbnail  */
  private docThumbnailTreeAndLookup = new Map<
    DocThumbnailTreeKey,
    [DocThumbnailTree, DocThumbnailHashToDocLookup]
  >();
  /** We use this for creating doc thumbnails during tree generation. */
  private hasher = new XXH64();

  /** Create or retrieve an existing DocThumbnailTree for use with range-based reconciliation. */
  getDocThumbnailTreeAndDocLookup<F>(
    share: ShareAddress,
    formats: FormatsArg<F>,
  ): {
    tree: DocThumbnailTree;
    lookup: DocThumbnailHashToDocLookup;
    treeIsReady: Promise<true>;
  } {
    // Create the key by which to look up information
    const formatNames = formats.map((f) => f.id);
    // e.g. "+something.a123 es.4,es.5"
    const key = `${share} ${formatNames}`;

    // Get a fingerprint tree for a given share
    const treeAndLookup = this.docThumbnailTreeAndLookup.get(key);

    // If it exists, just return it.
    if (treeAndLookup) {
      const [tree, lookup] = treeAndLookup;

      return { tree, lookup, treeIsReady: Promise.resolve(true) };
    }

    // If it doesn't, we need to create a tree.
    // Get the replica to build the tree with.
    const replica = this.peer.getReplica(share);

    if (!replica) {
      // This really shouldn't happen so I'm happy to throw here.
      throw new EarthstarError(
        "A DocThumbnailTree was requested for a share the peer doesn't know about, big problem!",
      );
    }

    // We're going to need this. Deconstructing as we need to use it in a different this context.
    const hasher = this.hasher;

    // Make a stream of all docs of the given formats.
    const queryStream = replica.getQueryStream(
      {
        historyMode: "all",
        orderBy: "localIndex ASC",
      },
      "everything",
      formats,
    );

    // Instantiate a new tree.
    const tree = new DocThumbnailTree();
    const lookup: DocThumbnailHashToDocLookup = {};
    const treeIsReady = deferred<true>();

    // Pipe the docs out, building the tree with them.
    queryStream.pipeTo(
      new WritableStream({
        write(event) {
          // We've processed all existing items and the tree is ready to use.
          if (event.kind === "processed_all_existing") {
            treeIsReady.resolve();
            return;
          }

          // Create the doc thumbnail.
          // First create a hash of the path and author.
          hasher.reset();
          hasher.update(`${event.doc.path} ${event.doc.author}`);
          const pathAuthorHash = hasher.digest().toString(16);

          // Compbine with doc timestamp
          // e.g. "104342348 a83dfac89ac"
          const thumbnail = `${event.doc.timestamp} ${pathAuthorHash}`;

          if (event.kind === "existing" || event.kind === "success") {
            // If the doc is existing or new, add it to the lookup.
            lookup[pathAuthorHash] = [
              event.doc.timestamp,
              event.doc.path,
              event.doc.author,
            ];
            tree.insert(thumbnail);
          }

          if (event.kind === "expire") {
            // If it's expiring, remove it.
            delete lookup[pathAuthorHash];
            tree.remove(thumbnail);
          }
        },
      }),
    );

    return { tree, lookup, treeIsReady };
  }

  // CONTINUOUS SYNC

  private plumTrees = new Map<ShareAddress, PlumTree>();

  getPlumTree(address: ShareAddress): PlumTree {
    const maybePlumTree = this.plumTrees.get(address);

    if (maybePlumTree) {
      return maybePlumTree;
    }

    const plumTree = new PlumTree();
    this.plumTrees.set(address, plumTree);
    return plumTree;
  }

  // Subscribe

  onSyncersChange(
    callback: (
      map: Map<
        string,
        { description: string; syncer: Syncer<unknown, unknown> }
      >,
    ) => void | Promise<void>,
  ) {
    return this.syncerEventBus.on(callback);
  }
}
