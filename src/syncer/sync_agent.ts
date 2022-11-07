import { BlockingBus } from "../streams/stream_utils.ts";
import {
  DocThumbnail,
  SyncAgentEvent,
  SyncAgentOpts,
  SyncAgentStatus,
} from "./syncer_types.ts";
import { getFormatLookup } from "../formats/util.ts";
import { FormatDocType } from "../formats/format_types.ts";
import { MultiDeferred } from "./multi_deferred.ts";
import { Replica } from "../replica/replica.ts";
import { AsyncQueue, deferred, XXH64 } from "../../deps.ts";
import { DocThumbnailTree } from "./doc_thumbnail_tree.ts";
import { EarthstarRangeMessenger } from "./range_messenger.ts";
import { AuthorAddress, Path, Timestamp } from "../util/doc-types.ts";
import { randomId } from "../util/misc.ts";

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

  private hashToDocInfo: Record<string, [Timestamp, Path, AuthorAddress]> = {};

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
  /** Note down a doc thumbnail we `WANT`ed */
  private registerWant(thumbnail: string) {
    this.fulfilledMap.set(thumbnail, false);
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
      hashToDocInfo,
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
    const hasher = new XXH64();

    queryStream.pipeTo(
      new WritableStream({
        write(event) {
          if (event.kind === "processed_all_existing") {
            treeIsReady.resolve();
            return;
          }

          hasher.reset();
          hasher.update(`${event.doc.path} ${event.doc.author}`);

          const pathAuthorHash = hasher.digest().toString(16);

          const thumbnail = `${event.doc.timestamp} ${pathAuthorHash}`;

          if (event.kind === "existing" || event.kind === "success") {
            hashToDocInfo[pathAuthorHash] = [
              event.doc.timestamp,
              event.doc.path,
              event.doc.author,
            ];
            docThumbnailTree.insert(thumbnail);
          }

          if (event.kind === "expire") {
            delete hashToDocInfo[pathAuthorHash];
            docThumbnailTree.remove(thumbnail);
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

    rangeMessenger.onInsertion((thumbnail) => {
      // Analyse...

      const [timestamp, hash] = thumbnail.split(" ");

      const entry = this.hashToDocInfo[hash];

      // If we have an entry and our entry's timestamp is higher we don't care about this.
      if (entry && entry[0] >= parseInt(timestamp)) {
        return;
      }

      // Otherwise we want this!
      registerWant(thumbnail);
      this.outboundEventQueue.push({ kind: "WANT", thumbnail });
      return;
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
            const [, hash] = event.thumbnail.split(" ");

            const entry = this.hashToDocInfo[hash];

            if (!entry) {
              return;
            }

            const [, path, author] = entry;

            const allVersions = await replica.getAllDocsAtPath(
              path,
            );

            // Iterate through each version we got back (which might just be one)

            // If the doc author matches this author...
            const doc = allVersions.find((doc) => doc.author === author);

            if (doc) {
              this.outboundEventQueue.push({
                kind: "DOC",
                thumbnail: event.thumbnail,
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

            if (fulfilledMap.has(event.thumbnail)) {
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

              fulfilWant(event.thumbnail);

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

    this.isFulfilled.then(async () => {
      this.outboundEventQueue.push({ kind: "FULFILLED" });

      await this.isPartnerFulfilled;

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
