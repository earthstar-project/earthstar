import { BlockingBus } from "../streams/stream_utils.ts";
import {
  SyncAgentEvent,
  SyncAgentOpts,
  SyncAgentStatus,
} from "./syncer_types.ts";
import { getFormatLookup } from "../formats/util.ts";
import { FormatDocType } from "../formats/format_types.ts";
import { MultiDeferred } from "./multi_deferred.ts";
import { Replica } from "../replica/replica.ts";
import { AsyncQueue, deferred } from "../../deps.ts";
import { DocThumbnailTree } from "./doc_thumbnail_tree.ts";
import { EarthstarRangeMessenger } from "./range_messenger.ts";

/** Mediates synchronisation on behalf of a `Replica`. Tells other SyncAgents what the Replica posseses, what it wants from them, and fulfils requests from other SyncAgents.
 */
export class SyncAgent<F> {
  /** A map of all the `HAVE` ids we've `WANT`ed and whether we received them or not. */
  private fulfilledMap: Map<string, boolean> = new Map();
  /** An integer representing the number of requests were fulfilled. Quicker than calculating this every time from the `fulfilledMap`. */
  private fulfilledCount = 0;

  /** A bus we can update the SyncAgent's status from, and which others can subscribe to. */
  private statusBus = new BlockingBus<SyncAgentStatus>();

  /** A promise for when the internal FingerprintTree is ready */
  private treeIsReady = deferred<true>();

  /** A promise for whether our partner SyncAgent has signalled its `DONE` or not. */
  private isPartnerFulfilled = deferred<true>();

  private isFulfilled = deferred<true>();

  /** A multi deferred describing if th the SyncAgent has finished or not. */
  private isDoneMultiDeferred = new MultiDeferred<void>();

  private inboundEventQueue = new AsyncQueue<SyncAgentEvent>();
  private outboundEventQueue = new AsyncQueue<SyncAgentEvent>();

  sendEvent(event: SyncAgentEvent): void {
    return this.inboundEventQueue.push(event);
  }

  events(): AsyncIterable<SyncAgentEvent> {
    return this.outboundEventQueue;
  }

  replica: Replica;

  /** The current status of this SyncAgent */
  getStatus(): SyncAgentStatus {
    return {
      requested: this.fulfilledMap.size,
      received: this.fulfilledCount,
      status: this.isDoneMultiDeferred.state === "rejected"
        ? "aborted"
        : this.treeIsReady.state === "pending"
        // Hasn't calculated initial hash yet
        ? "preparing"
        : this.fulfilledCount < this.fulfilledMap.size
        // Waiting on unfulfilled WANTs
        ? "syncing"
        : this.isDoneMultiDeferred.state === "fulfilled"
        // Partner is finished, no open requests.
        ? "done"
        // Connection held open for new docs.
        : "idling",
    };
  }
  /** Note down a `HAVE` ID we `WANT`ed */
  private registerWant(versionId: string) {
    this.fulfilledMap.set(versionId, false);
    this.statusBus.send(this.getStatus());
  }

  /** Note down that a `WANT` was fulfilled by the other side. */
  private fulfilWant(versionId: string) {
    const unfulfilledWant = this.fulfilledMap.get(versionId);

    // We didn't want this to begin with. Shouldn't happen.
    if (unfulfilledWant === undefined) {
      return false;
    }

    // This was already fulfilled. Shouldn't happen either.
    if (unfulfilledWant === true) {
      return true;
    }

    this.fulfilledMap.set(versionId, true);
    this.fulfilledCount++;
    this.statusBus.send(this.getStatus());
    return true;
  }

  constructor(
    {
      replica,
      mode,
      formats,
      transferManager,
      initiateMessaging,
      payloadThreshold,
      rangeDivision,
    }: SyncAgentOpts<F>,
  ) {
    // This is annoying, but we have to do this because of the identity of `this` changing when we define the streams below.
    const {
      statusBus,
      isPartnerFulfilled,
      fulfilledMap,
      isDoneMultiDeferred,
      treeIsReady,
    } = this;

    this.replica = replica;

    // If the replica closes, we need to abort
    replica.onEvent((event) => {
      if (event.kind === "willClose") {
        this.cancel();
      }
    });

    const queryStream = replica.getQueryStream(
      {
        historyMode: "all",
        orderBy: "localIndex ASC",
      },
      mode === "live" ? "everything" : "existing",
      formats,
    );

    // This is annoying, but we have to do this because of the identity of `this` changing when we define the streams below.
    const registerWant = this.registerWant.bind(this);
    const fulfilWant = this.fulfilWant.bind(this);
    const getStatus = this.getStatus.bind(this);
    const cancel = this.cancel.bind(this);

    // A little object we can look up formats by format name. In a type-safe-ish way.
    const formatLookup = getFormatLookup(formats);

    const docThumbnailTree = new DocThumbnailTree();

    // Send the replica's query stream to the HaveEntryKeeper so it can build the HAVE entries.
    queryStream.pipeTo(
      new WritableStream({
        write(event) {
          if (event.kind === "existing" || event.kind === "success") {
            docThumbnailTree.insertDoc(event.doc);
          }

          if (event.kind === "expire") {
            docThumbnailTree.removeDoc(event.doc);
          }

          if (event.kind === "processed_all_existing") {
            treeIsReady.resolve();
          }
        },
      }),
    );

    if (initiateMessaging) {
      treeIsReady.then(() => {
        for (const msg of rangeMessenger.initialMessages()) {
          this.outboundEventQueue.push({
            "kind": "RANGE_MSG",
            message: msg,
          });
        }
      });
    }

    const rangeMessenger = new EarthstarRangeMessenger(
      docThumbnailTree,
      payloadThreshold,
      rangeDivision,
    );

    rangeMessenger.onInsertion(async (thumbnail) => {
      // Analyse...

      const [timestamp, path, author] = thumbnail.split(" ");

      // TODO: This information is already in the tree, and the tree can get things synchronously.
      // But the thumbnails are all ordered by timestamp...
      // But maybe this okay...?
      const docs = await replica.getAllDocsAtPath(path);

      if (docs.length === 0) {
        // Nothing with this path, definitely want.
        registerWant(thumbnail);
        this.outboundEventQueue.push({ kind: "WANT", thumbnail });
        return;
      }

      const indexOfDocbyAuthor = docs.findIndex((doc) => doc.author === author);

      if (indexOfDocbyAuthor === -1) {
        // Don't have this author, definitely want.
        registerWant(thumbnail);
        this.outboundEventQueue.push({ kind: "WANT", thumbnail });
        return;
      }

      const doc = docs[indexOfDocbyAuthor];

      if (doc.timestamp < parseInt(timestamp)) {
        // This one has a newer timestamp, we want that.
        registerWant(thumbnail);
        this.outboundEventQueue.push({ kind: "WANT", thumbnail });
      }
    });

    // Read events from the other SyncAgent
    // And we handle them here.
    (async () => {
      for await (const event of this.inboundEventQueue) {
        if (isDoneMultiDeferred.state === "rejected") {
          return;
        }

        switch (event.kind) {
          case "RANGE_MSG": {
            if (rangeMessenger.isDone().state === "fulfilled") {
              return;
            }

            const responses = rangeMessenger.respond(event.message);

            for (const response of responses) {
              this.outboundEventQueue.push({
                kind: "RANGE_MSG",
                message: response,
              });
            }

            break;
          }

          case "WANT": {
            // Check if we have this thumbnail.
            // Fetch the path + authors associated with it and send them off.
            const [, path, author] = event.thumbnail.split(" ");

            const allVersions = await replica.getAllDocsAtPath(
              path,
            );

            // Iterate through each version we got back (which might just be one)

            // If the doc author matches this author...
            const doc = allVersions.find((doc) => doc.author === author);

            if (doc) {
              this.outboundEventQueue.push({
                kind: "DOC",
                doc,
              });
            } else {
              console.error("Got a WANT event for a document not on record.");
            }

            break;
          }

          case "DOC": {
            // Ingest a document.
            // Check if we ever asked for this.

            const thumbnail =
              `${event.doc.timestamp} ${event.doc.path} ${event.doc.author}`;

            if (fulfilledMap.has(thumbnail)) {
              const format = formatLookup[event.doc.format];

              if (!format) {
                console.error(
                  `Was sent a doc with a format we don't know about (${event.doc.format})`,
                );
                break;
              }

              const attachment = await replica.getAttachment(
                event.doc as FormatDocType<F>,
                formatLookup[event.doc.format],
              );

              // if attachment is undefined, request.
              if (attachment === undefined) {
                const canDownload = await transferManager.handleDownload(
                  event.doc as FormatDocType<F>,
                  replica,
                );

                if (!canDownload) {
                  const attachmentInfo = format.getAttachmentInfo(
                    event.doc,
                  ) as { size: number; hash: string };

                  transferManager.registerExpectedTransfer(
                    replica.share,
                    attachmentInfo.hash,
                  );

                  this.outboundEventQueue.push({
                    kind: "WANT_ATTACHMENT",
                    attachmentHash: attachmentInfo.hash,
                    doc: event.doc,
                    shareAddress: replica.share,
                  });
                }
              }

              await replica.ingest(format, event.doc as FormatDocType<F>);

              fulfilWant(thumbnail);

              break;
            } else {
              console.error("Was sent a doc we never asked for");
            }

            break;
          }
          case "FULFILLED":
            isPartnerFulfilled.resolve(true);
            break;

          case "WANT_ATTACHMENT":
            transferManager.handleUpload(event, replica);
            break;

          case "ABORT":
            await cancel();
        }
      }
    })();

    rangeMessenger.isDone().then(() => {
      const status = this.getStatus();

      if (status.received === status.requested) {
        this.isFulfilled.resolve(true);
      } else {
        const unsub = this.onStatusUpdate((statusUpdate) => {
          if (statusUpdate.received === statusUpdate.requested) {
            unsub();
            this.isFulfilled.resolve(true);
          }
        });
      }
    });

    this.isFulfilled.then(() => {
      this.outboundEventQueue.push({ kind: "FULFILLED" });
    });

    this.isPartnerFulfilled.then(async () => {
      await this.isFulfilled;

      this.isDoneMultiDeferred.resolve();
      this.outboundEventQueue.close();
    });

    this.isDoneMultiDeferred.getPromise().then(() => {
      this.statusBus.send(this.getStatus());
    }).catch(() => {
      statusBus.send(getStatus());
    });
  }

  /** Subscribe to status updates with a callback. */
  onStatusUpdate(callback: (status: SyncAgentStatus) => void) {
    return this.statusBus.on(callback);
  }

  /** Signal the SyncAgent to wrap up syncing early. */
  async cancel(reason?: string) {
    // Can't cancel if we're already done or cancelled previously.
    if (
      this.isDoneMultiDeferred.state === "fulfilled" ||
      this.isDoneMultiDeferred.state === "rejected"
    ) {
      return;
    }

    this.outboundEventQueue.push({ kind: "ABORT" });
    this.outboundEventQueue.close();
  }

  isDone() {
    return this.isDoneMultiDeferred.getPromise();
  }
}
