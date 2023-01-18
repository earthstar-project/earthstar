import { BlockingBus } from "../streams/stream_utils.ts";
import {
  DocThumbnail,
  RangeMessage,
  SyncAgentEvent,
  SyncAgentOpts,
  SyncAgentStatus,
  SyncAppetite,
} from "./syncer_types.ts";
import { getFormatLookup, getFormatsWithFallback } from "../formats/util.ts";
import { FormatDocType, FormatsArg } from "../formats/format_types.ts";
import { MultiDeferred } from "./multi_deferred.ts";
import { Replica } from "../replica/replica.ts";
import { AsyncQueue, Deferred, deferred, XXH64 } from "../../deps.ts";
import { EarthstarRangeMessenger } from "./range_messenger.ts";
import { PromiseEnroller } from "./promise_enroller.ts";
import { randomId } from "../util/misc.ts";
import { SyncerManager } from "./syncer_manager.ts";
import { TransferManager } from "./transfer_manager.ts";
import { isErr } from "../util/errors.ts";
import { MultiformatReplica } from "../replica/multiformat_replica.ts";
import { QuerySourceEvent } from "../replica/replica-types.ts";

/** Mediates synchronisation on behalf of a `Replica`.
 */
export class SyncAgent<F> {
  /** A bus we can update the SyncAgent's status from, and which others can subscribe to. */
  private statusBus = new BlockingBus<SyncAgentStatus>();

  /** A multi deferred describing if th the SyncAgent has finished or not. */
  private isDoneMultiDeferred = new MultiDeferred<void>();

  /** Messages coming in from the other peer */
  private inboundEventQueue = new AsyncQueue<SyncAgentEvent>();
  /** Messages generated from us destined for the other peer. */
  private outboundEventQueue = new AsyncQueue<SyncAgentEvent>();

  private gossiperInboundQueue = new AsyncQueue<SyncAgentEvent>();
  private reconcilerInboundQueue = new AsyncQueue<RangeMessage>();

  private hasPrepared = deferred();
  private hasReconciled = deferred();
  private hasCheckedAllExistingDocsForAttachments = deferred();

  private requestedCount = 0;
  private sentDocsCount = 0;
  private receivedDocsCount = 0;

  /** An internal ID we use to distinguish messages from the agent we're syncing with from other messages and docs. */
  counterpartId = randomId();

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
      requestedCount: this.requestedCount,
      receivedCount: this.receivedDocsCount,
      sentCount: this.sentDocsCount,
      status: this.isDoneMultiDeferred.state === "rejected"
        ? "aborted"
        : this.hasPrepared.state === "pending"
        ? "preparing"
        : this.hasReconciled.state === "pending"
        ? "reconciling"
        : this.isDoneMultiDeferred.state === "fulfilled"
        ? "done"
        : "gossiping",
    };
  }

  constructor(
    opts: SyncAgentOpts<F>,
  ) {
    this.replica = opts.replica;

    // If the replica closes, we need to abort
    opts.replica.onEvent((event) => {
      if (event.kind === "willClose") {
        this.cancel();
      }
    });

    const { treeIsReady } = opts.syncerManager
      .getDocThumbnailTreeAndDocLookup(
        opts.replica.share,
        getFormatsWithFallback(opts.formats),
      );

    treeIsReady.then(() => {
      this.hasPrepared.resolve();
    });

    (async () => {
      for await (const event of this.inboundEventQueue) {
        switch (event.kind) {
          case "RANGE_MSG": {
            this.reconcilerInboundQueue.push(event.message);
            break;
          }
          default: {
            this.gossiperInboundQueue.push(event);
          }
        }
      }
    })();

    const existingDocAttachmentChecker = new ExistingDocAttachmentChecker({
      outboundEventQueue: this.outboundEventQueue,
      formats: opts.formats,
      replica: opts.replica,
      counterpartId: this.counterpartId,
      transferManager: opts.transferManager,
      hasCheckedAllExistingDocsForAttachments:
        this.hasCheckedAllExistingDocsForAttachments,
    });

    const wantTracker = new WantTracker();

    const reconciler = new SyncAgentReconciler({
      inboundEventQueue: this.reconcilerInboundQueue,
      outboundEventQueue: this.outboundEventQueue,
      syncerManager: opts.syncerManager,
      formats: opts.formats,
      replica: opts.replica,
      initiateMessaging: opts.initiateMessaging,
      wantTracker: wantTracker,
      payloadThreshold: opts.payloadThreshold,
      rangeDivision: opts.rangeDivision,
      onDocRequested: async () => {
        this.requestedCount++;
        await this.statusBus.send(this.getStatus());
      },
    });

    reconciler.isDone.then(() => {
      this.hasReconciled.resolve();
    });

    // Perform first round of reconciliation
    const gossiper = new SyncAgentGossiper({
      inboundEventQueue: this.gossiperInboundQueue,
      outboundEventQueue: this.outboundEventQueue,
      syncerManager: opts.syncerManager,
      formats: opts.formats,
      replica: opts.replica,
      counterpartId: this.counterpartId,
      transferManager: opts.transferManager,
      cancel: this.cancel.bind(this),
      reconciliationIsDone: reconciler.isDone,
      wantTracker: wantTracker,
      syncAppetite: opts.syncAppetite,
      onDocReceived: async () => {
        this.receivedDocsCount++;
        await this.statusBus.send(this.getStatus());
      },
      onDocSent: async () => {
        this.sentDocsCount++;
        await this.statusBus.send(this.getStatus());
      },
      onDocRequested: async () => {
        this.requestedCount++;
        await this.statusBus.send(this.getStatus());
      },
    });

    // Resolves when this gossiper has everything it wants and its counterpart is fulfilled. Never resolves if appetite is 'continuous'.
    gossiper.isDone.then(async () => {
      await this.hasCheckedAllExistingDocsForAttachments;

      this.isDoneMultiDeferred.resolve();
    });

    this.statusBus.send(this.getStatus());
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

    this.isDoneMultiDeferred.reject();

    await this.statusBus.send(this.getStatus());

    this.outboundEventQueue.push({ kind: "ABORT" });
    this.outboundEventQueue.close();
    this.inboundEventQueue.close({ immediately: true });
    this.gossiperInboundQueue.close({ immediately: true });
    this.reconcilerInboundQueue.close({ immediately: true });
  }

  isDone() {
    return this.isDoneMultiDeferred.getPromise();
  }
}

type GossiperOpts<F> = {
  inboundEventQueue: AsyncQueue<SyncAgentEvent>;
  outboundEventQueue: AsyncQueue<SyncAgentEvent>;
  syncerManager: SyncerManager;
  formats: FormatsArg<F> | undefined;
  replica: MultiformatReplica;
  counterpartId: string;
  transferManager: TransferManager<F, unknown>;
  wantTracker: WantTracker;
  reconciliationIsDone: Deferred<number>;
  syncAppetite: SyncAppetite;
  cancel: () => Promise<void>;
  onDocReceived: () => Promise<void>;
  onDocSent: () => Promise<void>;
  onDocRequested: () => Promise<void>;
};

export class SyncAgentGossiper<F> {
  private isPartnerFulfilled = deferred();
  private isFulfilled = deferred();

  constructor(opts: GossiperOpts<F>) {
    // A little object we can look up formats by format name. In a type-safe-ish way.
    const formatLookup = getFormatLookup(opts.formats);

    const plumTree = opts.syncerManager.getPlumTree(opts.replica.share);

    // Create a query stream for new events.
    if (opts.syncAppetite === "continuous") {
      const queryStream = opts.replica.getQueryStream(
        undefined,
        "new",
        opts.formats,
      );

      const hasher = new XXH64();

      // Send new messages from self / other peers eagerly or lazily depending on plum tree.
      queryStream.pipeTo(
        new WritableStream({
          async write(event) {
            if (
              event.kind === "success" && event.sourceId !== opts.counterpartId
            ) {
              const mode = plumTree.getMode(event.sourceId);

              // Create the doc thumbnail.
              // First create a hash of the path and author.
              hasher.reset();
              hasher.update(`${event.doc.path} ${event.doc.author}`);
              const pathAuthorHash = hasher.digest().toString(16);

              // Compbine with doc timestamp
              // e.g. "104342348 a83dfac89ac"
              const thumbnail = `${event.doc.timestamp} ${pathAuthorHash}`;

              if (mode === "EAGER") {
                const format = formatLookup[event.doc.format];
                const attachmentRes = format.getAttachmentInfo(event.doc);
                const canHaveAttachment = isErr(attachmentRes) ? false : true;

                let attachmentHeld = false;

                if (canHaveAttachment) {
                  const attachment = await opts.replica.getAttachment(
                    event.doc,
                    format,
                  );

                  if (attachment) {
                    attachmentHeld = true;
                  }
                }

                opts.outboundEventQueue.push({
                  kind: "DOC",
                  thumbnail: thumbnail,
                  doc: event.doc,
                  attachmentHeld,
                });

                opts.onDocSent();
              } else {
                opts.outboundEventQueue.push({
                  kind: "HAVE",
                  thumbnail: thumbnail,
                });
              }
            }
          },
        }),
      ).catch(() => {
        // The query stream was cancelled.
      });
    }

    const unsubAttachmentIngestEvents = opts.replica.onEvent((event) => {
      if (
        event.kind === "attachment_ingest" &&
        event.sourceId !== opts.counterpartId
      ) {
        opts.outboundEventQueue.push({
          kind: "NEW_ATTACHMENT",
          path: event.doc.path,
          author: event.doc.author,
          format: event.doc.format,
          hash: event.hash,
        });
      }
    });

    const { lookup: thumbnailHashLookup } = opts.syncerManager
      .getDocThumbnailTreeAndDocLookup(
        opts.replica.share,
        getFormatsWithFallback(opts.formats),
      );

    // Read events from the other SyncAgent
    // And we handle them here.
    (async () => {
      for await (const event of opts.inboundEventQueue) {
        switch (event.kind) {
          case "PRUNE": {
            plumTree.onPrune(opts.counterpartId);
            break;
          }

          case "HAVE": {
            // Ignore HAVE messages if reconciliation finished and we are only syncing once.
            if (
              opts.reconciliationIsDone.state === "fulfilled" &&
              opts.syncAppetite === "once"
            ) {
              break;
            }

            opts.wantTracker.addWantedThumbnail(event.thumbnail);

            plumTree.onLazyMessage(event, (thumbnail) => {
              opts.outboundEventQueue.push({
                kind: "WANT",
                thumbnail,
              });
            });

            opts.onDocRequested();

            break;
          }

          case "WANT": {
            plumTree.onGraftMessage(opts.counterpartId);

            // Check if we have this thumbnail.
            // Fetch the path + authors associated with it and send them off.
            const [, hash] = event.thumbnail.split(" ");

            const entry = thumbnailHashLookup[hash];

            if (!entry) {
              return;
            }

            const [, path, author] = entry;

            const allVersions = await opts.replica.getAllDocsAtPath(
              path,
              opts.formats,
            );

            // Iterate through each version we got back (which might just be one)

            // If the doc author matches this author...
            const doc = allVersions.find((doc) => doc.author === author);

            if (doc) {
              const format = formatLookup[doc.format];
              const attachmentRes = format.getAttachmentInfo(doc);
              const canHaveAttachment = isErr(attachmentRes) ? false : true;

              let attachmentHeld = false;

              if (canHaveAttachment) {
                const attachment = await opts.replica.getAttachment(
                  doc,
                  format,
                );

                if (attachment) {
                  attachmentHeld = true;
                }
              }

              opts.outboundEventQueue.push({
                kind: "DOC",
                thumbnail: event.thumbnail,
                doc,
                attachmentHeld,
              });

              await opts.onDocSent();
            } else {
              console.error("Got a WANT event for a document not on record.");
            }

            break;
          }

          case "DOC": {
            // Ignore DOC messages if we fulfilled our and we are only syncing once.
            if (
              this.isFulfilled.state === "fulfilled" &&
              opts.syncAppetite === "once"
            ) {
              break;
            }

            // Ingest a document.
            const shouldPrune = plumTree.onEagerMessage(
              opts.counterpartId,
              event,
            );

            if (shouldPrune) {
              opts.outboundEventQueue.push({ kind: "PRUNE" });
            }

            if (opts.wantTracker.isReceived(event.thumbnail)) {
              break;
            }

            const format = formatLookup[event.doc.format];

            if (!format) {
              console.error(
                `Was sent a doc with a format we don't know about (${event.doc.format})`,
              );
              break;
            }

            if (event.attachmentHeld) {
              const attachment = await opts.replica.getAttachment(
                event.doc as FormatDocType<F>,
                formatLookup[event.doc.format],
              );

              // if attachment is undefined, request.
              if (attachment === undefined) {
                const result = await opts.transferManager.handleDownload(
                  event.doc as FormatDocType<F>,
                  opts.replica,
                  opts.counterpartId,
                );

                // Direct download not supported, send an upload request instead.
                if (isErr(result)) {
                  const attachmentInfo = format.getAttachmentInfo(
                    event.doc,
                  ) as { size: number; hash: string };

                  opts.transferManager.registerExpectedTransfer(
                    opts.replica.share,
                    attachmentInfo.hash,
                  );

                  opts.outboundEventQueue.push({
                    kind: "WANT_ATTACHMENT",
                    attachmentHash: attachmentInfo.hash,
                    doc: event.doc,
                    shareAddress: opts.replica.share,
                  });
                }
              }
            }

            await opts.replica.ingest(
              format,
              event.doc as FormatDocType<F>,
              opts.counterpartId,
            );

            opts.wantTracker.receivedWantedThumbnail(event.thumbnail);

            await opts.onDocReceived();

            break;
          }

          case "NEW_ATTACHMENT": {
            if (opts.transferManager.isAlreadyQueued(event.hash, "download")) {
              break;
            }

            const format = formatLookup[event.format];

            const pathDocs = await opts.replica.getAllDocsAtPath(event.path, [
              format,
            ]);

            const docForAuthor = pathDocs.find((doc) =>
              event.author === doc.author
            );

            if (!docForAuthor) {
              // weird. you'd hope we'd have this document.
              break;
            }

            const attachment = await opts.replica.getAttachment(
              docForAuthor as FormatDocType<F>,
              formatLookup[docForAuthor.format],
            );

            // if attachment is undefined, request.
            if (attachment === undefined) {
              const result = await opts.transferManager.handleDownload(
                docForAuthor as FormatDocType<F>,
                opts.replica,
                opts.counterpartId,
              );

              // Direct download not supported, send an upload request instead.
              if (isErr(result)) {
                const attachmentInfo = format.getAttachmentInfo(
                  docForAuthor,
                ) as { size: number; hash: string };

                opts.transferManager.registerExpectedTransfer(
                  opts.replica.share,
                  attachmentInfo.hash,
                );

                opts.outboundEventQueue.push({
                  kind: "WANT_ATTACHMENT",
                  attachmentHash: attachmentInfo.hash,
                  doc: docForAuthor,
                  shareAddress: opts.replica.share,
                });
              }
            }

            break;
          }

          case "FULFILLED":
            this.isPartnerFulfilled.resolve(true);
            break;

          case "WANT_ATTACHMENT":
            opts.transferManager.handleUpload(event, opts.replica);
            break;

          case "ABORT":
            await opts.cancel();
        }
      }
    })();

    opts.reconciliationIsDone.then(async () => {
      if (opts.syncAppetite === "once") {
        unsubAttachmentIngestEvents();

        opts.wantTracker.seal();

        await opts.wantTracker.isDone();

        opts.outboundEventQueue.push({ kind: "FULFILLED" });

        this.isFulfilled.resolve();
      }
    });
  }

  /** A promise which completes when this gossiper has gotten everything it has asked for and its counterpart is fulfilled.
   *
   * Will never resolve if sync appetite is 'continuous'.
   */
  get isDone() {
    return Promise.all([this.isPartnerFulfilled, this.isFulfilled]);
  }
}

type ReconcilerOpts<F> = {
  inboundEventQueue: AsyncQueue<RangeMessage>;
  outboundEventQueue: AsyncQueue<SyncAgentEvent>;
  wantTracker: WantTracker;
  replica: Replica;
  syncerManager: SyncerManager;
  initiateMessaging: boolean;
  formats: FormatsArg<F> | undefined;
  payloadThreshold: number;
  rangeDivision: number;
  onDocRequested: () => void;
};

class SyncAgentReconciler<F> {
  private communicationRoundsCount = 0;

  /** A promise returning a number representing the number of communication rounds which were needed to complete reconciliation.*/
  isDone = deferred<number>();

  constructor(opts: ReconcilerOpts<F>) {
    const { tree, lookup, treeIsReady } = opts.syncerManager
      .getDocThumbnailTreeAndDocLookup(
        opts.replica.share,
        getFormatsWithFallback(opts.formats),
      );

    if (opts.initiateMessaging) {
      treeIsReady.then(() => {
        for (
          const msg of rangeMessenger.initialMessages((items) => {
            // Find first item with timestamp gte last week, split there.

            const lastWeek = Date.now() - (7 * 24 * 60 * 60 * 1000);

            const firstItemLastWeekIndex = items.findIndex((item) => {
              const [timestamp] = item.split(" ");

              const timestampInt = parseInt(timestamp);

              return timestampInt / 1000 > lastWeek;
            });

            if (
              firstItemLastWeekIndex > 0 &&
              firstItemLastWeekIndex > items.length / 2
            ) {
              return [
                items.slice(0, firstItemLastWeekIndex),
                items.slice(firstItemLastWeekIndex),
              ];
            }

            // If items in the last week are bigger than all time, just split in half.
            const halfway = Math.round(items.length / 2);

            return [items.slice(0, halfway), items.slice(halfway)];
          })
        ) {
          opts.outboundEventQueue.push({
            "kind": "RANGE_MSG",
            message: msg,
          });
        }
      });
    }

    const rangeMessenger = new EarthstarRangeMessenger(
      tree,
      opts.payloadThreshold,
      opts.rangeDivision,
    );

    rangeMessenger.onInsertion((thumbnail) => {
      // Analyse...

      const [timestamp, hash] = thumbnail.split(" ");

      const entry = lookup[hash];

      // If we have an entry AND our entry's timestamp is higher we don't care about this.
      if (entry && entry[0] >= parseInt(timestamp)) {
        return;
      }

      // Otherwise we want this!
      opts.wantTracker.addWantedThumbnail(thumbnail);

      opts.outboundEventQueue.push({ kind: "WANT", thumbnail });

      opts.onDocRequested();
    });

    // Read events from the other SyncAgent
    // And we handle them here.

    (async () => {
      await treeIsReady;

      for await (const message of opts.inboundEventQueue) {
        if (this.isDone.state === "fulfilled") {
          return;
        }

        if (message.type === "TERMINAL") {
          this.communicationRoundsCount++;
        }

        const responses = rangeMessenger.respond(message);

        for (const response of responses) {
          opts.outboundEventQueue.push({
            kind: "RANGE_MSG",
            message: response,
          });
        }
      }
    })();

    rangeMessenger.isDone().then(() => {
      this.isDone.resolve(this.communicationRoundsCount);
    });
  }
}

type ExistingDocAttachmentCheckerOpts<F> = {
  outboundEventQueue: AsyncQueue<SyncAgentEvent>;
  formats: FormatsArg<F> | undefined;
  replica: MultiformatReplica;
  counterpartId: string;
  transferManager: TransferManager<F, unknown>;
  hasCheckedAllExistingDocsForAttachments: Deferred<unknown>;
};

class ExistingDocAttachmentChecker<F> {
  constructor(opts: ExistingDocAttachmentCheckerOpts<F>) {
    const existingDocsStream = opts.replica.getQueryStream(
      { orderBy: "localIndex ASC" },
      "existing",
      opts.formats,
    );

    const formatLookup = getFormatLookup(opts.formats);
    const handleDownload = opts.transferManager.handleDownload.bind(
      opts.transferManager,
    );

    existingDocsStream.pipeTo(
      new WritableStream<
        QuerySourceEvent<FormatDocType<F>>
      >({
        start(controller) {
          opts.replica.onEvent((event) => {
            if (event.kind === "willClose") {
              controller.error();
            }
          });
        },
        async write(event) {
          if (event.kind === "existing" || event.kind === "success") {
            // Get the right format here...
            const format = formatLookup[event.doc.format];

            const res = await opts.replica.getAttachment(event.doc, format);

            if (isErr(res)) {
              // This doc can't have an attachment attached. Do nothing.
              return;
            } else if (res === undefined) {
              const downloadResult = await handleDownload(
                event.doc,
                opts.replica,
                opts.counterpartId,
              );

              // Direct download not supported, send an upload request instead.
              if (isErr(downloadResult)) {
                const attachmentInfo = format.getAttachmentInfo(
                  event.doc,
                ) as { size: number; hash: string };

                opts.transferManager.registerExpectedTransfer(
                  opts.replica.share,
                  attachmentInfo.hash,
                );

                opts.outboundEventQueue.push({
                  kind: "WANT_ATTACHMENT",
                  attachmentHash: attachmentInfo.hash,
                  doc: event.doc,
                  shareAddress: opts.replica.share,
                });
              }
            }
          }
        },
      }),
    ).then(() => {
      // We are done checking existing docs
      opts.hasCheckedAllExistingDocsForAttachments.resolve();
    }).catch(() => {
      // The replica was closed (probably because syncing was cancelled).
      opts.hasCheckedAllExistingDocsForAttachments.resolve();
    });
  }
}

/** Tracks which documents a SyncAgent has sent WANT messages for and how many have actually been received. */
class WantTracker {
  private isSealed = false;
  private wantedThumbnails = new Map<DocThumbnail, Deferred<true>>();

  private enroller = new PromiseEnroller();
  private received = 0;

  id = randomId();

  addWantedThumbnail(thumbnail: DocThumbnail) {
    if (!this.isSealed && !this.wantedThumbnails.has(thumbnail)) {
      const wantedDeferred = deferred<true>();
      this.wantedThumbnails.set(thumbnail, wantedDeferred);

      this.enroller.enrol(wantedDeferred);
    }
  }

  receivedWantedThumbnail(thumbnail: DocThumbnail) {
    const maybeDeferred = this.wantedThumbnails.get(thumbnail);

    if (maybeDeferred) {
      maybeDeferred.resolve();
      this.received++;
    }
  }

  isRequested(thumbnail: DocThumbnail) {
    return this.wantedThumbnails.has(thumbnail);
  }

  isReceived(thumbnail: DocThumbnail) {
    const maybeDeferred = this.wantedThumbnails.get(thumbnail);

    if (!maybeDeferred) {
      return false;
    }

    return maybeDeferred.state === "fulfilled";
  }

  seal() {
    this.enroller.seal();
  }

  isDone() {
    return this.enroller.isDone();
  }

  get requestedCount() {
    return this.wantedThumbnails.size;
  }

  get receivedCount() {
    return this.received;
  }
}
