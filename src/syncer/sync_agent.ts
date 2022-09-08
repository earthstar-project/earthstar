import { BlockingBus } from "../streams/stream_utils.ts";
import { HaveEntryKeeper } from "./have_entry_keeper.ts";
import {
  HaveEntry,
  SyncAgentEvent,
  SyncAgentOpts,
  SyncAgentStatus,
} from "./syncer_types.ts";
import { getFormatLookup } from "../formats/util.ts";
import { FormatDocType } from "../formats/format_types.ts";
import { MultiDeferred } from "./multi_deferred.ts";
import { Replica } from "../replica/replica.ts";
import { deferred } from "../../deps.ts";

/** Mediates synchronisation on behalf of a `Replica`. Tells other SyncAgents what the Replica posseses, what it wants from them, and fulfils requests from other SyncAgents.
 */
export class SyncAgent<F> {
  /** A bus to send events to, and which our readable streams subcribe to. */
  private outboundEventBus = new BlockingBus<
    // Add a special internal kind to signal to the stream that it should close. This is never sent to the other peers.
    SyncAgentEvent | { kind: "CMD_FINISHED" }
  >();

  /** Here we keep track of all the root IDs of versions we've `WANT`ed. Used to prevent offering things to another peer which they already have. */
  private rootIdsRequested: Set<string> = new Set();
  /** A map of all the `HAVE` ids we've `WANT`ed and whether we received them or not. */
  private fulfilledMap: Map<string, boolean> = new Map();
  /** An integer representing the number of requests were fulfilled. Quicker than calculating this every time from the `fulfilledMap`. */
  private fulfilledCount = 0;

  /** A bus we can update the SyncAgent's status from, and which others can subscribe to. */
  private statusBus = new BlockingBus<SyncAgentStatus>();

  /** A promise of a hash of all documents we hold once existing documents have been processed.  */
  private initialHash = deferred<string>();

  /** A promise for when we have received all HAVEs our partner has on offer */
  gotAllPartnerHaves = deferred<true>();

  /** A promise for whether our partner SyncAgent has signalled its `DONE` or not. */
  private isPartnerFulfilled = deferred<true>();

  private isFulfilled = deferred<true>();

  /** A multi deferred describing if th the SyncAgent has finished or not. */
  private isDoneMultiDeferred = new MultiDeferred<void>();

  /** A writable stream which takes incoming messages from another SyncAgent. */
  writable: WritableStream<SyncAgentEvent>;
  /** A readable stream of outbound events intended for a `SyncAgent` partner. */
  readable: ReadableStream<SyncAgentEvent>;

  replica: Replica;

  /** The current status of this SyncAgent */
  getStatus(): SyncAgentStatus {
    return {
      requested: this.fulfilledMap.size,
      received: this.fulfilledCount,
      status: this.isDoneMultiDeferred.state === "rejected"
        ? "aborted"
        : this.initialHash.state === "pending"
        // Hasn't calculated initial hash yet
        ? "preparing"
        : this.fulfilledCount < this.fulfilledMap.size
        // Waiting on unfulfilled WANTs
        ? "syncing"
        : this.isDoneMultiDeferred.state === "fulfilled"
        // Partner is finished, no open requests.
        ? "done"
        : // Connection held open for new docs.
          "idling",
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
    { replica, mode, formats, transferManager }: SyncAgentOpts<F>,
  ) {
    // This is annoying, but we have to do this because of the identity of `this` changing when we define the streams below.
    const {
      outboundEventBus,
      statusBus,
      initialHash,
      isPartnerFulfilled,
      fulfilledMap,
      rootIdsRequested,
      isDoneMultiDeferred,
      isFulfilled,
      gotAllPartnerHaves,
    } = this;

    this.replica = replica;

    // If the replica closes, we need to abort
    replica.onEvent((event) => {
      if (event.kind === "willClose") {
        this.cancel();
      }
    });

    const haveEntryKeeper = new HaveEntryKeeper(
      mode === "live" ? "everything" : "existing",
    );

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

    // A writable which receives HaveEntry from the keeper, and sends out `HAVE` events for them.
    const haveEntrySink = new WritableStream<HaveEntry>({
      write(haveEntry) {
        if (rootIdsRequested.has(haveEntry.id)) {
          return;
        }

        outboundEventBus.send({
          kind: "HAVE",
          ...haveEntry,
        });
      },
    });

    // Send the replica's query stream to the HaveEntryKeeper so it can build the HAVE entries.
    queryStream.pipeTo(haveEntryKeeper.writable);

    // Once the HaveEntryKeeper has looked at all existing documents, it's ready.
    // So send out the initial hash.
    haveEntryKeeper.isReady().then(() => {
      const hash = haveEntryKeeper.getHash();
      this.initialHash.resolve(hash);
      outboundEventBus.send({ kind: "HASH", hash });
    });

    gotAllPartnerHaves.then(async () => {
      await isFulfilled;
      await isPartnerFulfilled;
      await outboundEventBus.send({ kind: "CMD_FINISHED" });
    });

    // This writable takes events from the other SyncAgent
    // And we handle them here.
    this.writable = new WritableStream<SyncAgentEvent>({
      async write(event) {
        if (isDoneMultiDeferred.state === "rejected") {
          return;
        }

        switch (event.kind) {
          case "HASH": {
            // Wait for our hash to be calculated before comparing.
            const ourHash = await initialHash;

            // The hashes match and we're not hanging around because we only wanted existing docs,
            // Which are apparently exactly the same.
            // Consider the other side finished and exit.
            if (ourHash === event.hash && mode === "only_existing") {
              gotAllPartnerHaves.resolve();
              isFulfilled.resolve();
              break;
            }

            // The hashes match, but we do want to see if new updates trickle in.
            // Only send new events from the haveEntryKeeper.
            if (ourHash === event.hash && mode === "live") {
              haveEntryKeeper.onlyLiveReadable.pipeTo(haveEntrySink);
              break;
            }

            // Otherwise we just want to pipe all HaveEntries to the other side
            haveEntryKeeper.readable.pipeTo(haveEntrySink).then(() => {
              outboundEventBus.send({ kind: "EXHAUSTED_HAVES" });
            });

            break;
          }
          case "HAVE": {
            // Check if we want it. If so, queue up a WANT event

            // First: Does our entry keeper have an ID like this?
            // If not, that means we don't have any docs associated with the path this ID was made from.
            // We want it!
            if (!haveEntryKeeper.hasEntryWithId(event.id)) {
              await outboundEventBus.send({ kind: "WANT", id: event.id });

              // Internally register a WANT for each version, even though we sent out a single one for the root ID.
              // The other side will send back the DOC with the version ID, NOT the root ID.
              for (const versionId in event.versions) {
                registerWant(versionId);
                rootIdsRequested.add(event.id);
              }

              break;
            }

            // If we do have this ID, we need to compare the versions.
            for (const haveId in event.versions) {
              const timestamp = event.versions[haveId];

              if (fulfilledMap.has(haveId)) {
                // We're already waiting for this version, skip to the next one.
                continue;
              }

              const existingEntry = haveEntryKeeper.getId(haveId);

              // If we don't have a version with this ID,
              // That means we don't have any documents by the author associated with this ID at this path.
              // We want it!
              if (!existingEntry) {
                await outboundEventBus.send({ kind: "WANT", id: haveId });
                registerWant(haveId);
                rootIdsRequested.add(event.id);
                continue;
              }

              // If we do have a version with this ID, we should compare timestamps.
              // If the one on record is lower, we want this newer version.
              const existingTimestamp = existingEntry.versions[haveId];
              if (timestamp > existingTimestamp) {
                await outboundEventBus.send({ kind: "WANT", id: haveId });

                rootIdsRequested.add(event.id);
                registerWant(haveId);
              }
            }

            break;
          }
          case "WANT": {
            // Check if we have this ID.
            // Fetch the path + authors associated with it and send them off.
            const maybePathAndVersions = haveEntryKeeper
              .getPathAndVersionsForId(
                event.id,
              );

            // This could happen if the document was ephemeral and was deleted in between the HAVE event being sent and received. I guess.
            if (!maybePathAndVersions) {
              console.error(
                "Got a WANT event for a document not on record.",
              );
              break;
            }

            const allVersions = await replica.getAllDocsAtPath(
              maybePathAndVersions.path,
            );

            // Iterate through each version we got back (which might just be one)
            for (const id in maybePathAndVersions.versions) {
              const authorAddress = maybePathAndVersions.versions[id];
              // If the doc author matches this author...
              const doc = allVersions.find((doc) =>
                doc.author === authorAddress
              );

              if (doc) {
                await outboundEventBus.send({
                  kind: "DOC",
                  id,
                  doc,
                });
              } else {
                console.error("Got a WANT event for a document not on record.");
              }
            }

            break;
          }

          case "DOC": {
            // Ingest a document.
            // Check if we ever asked for this.

            if (fulfilledMap.has(event.id)) {
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

                  await outboundEventBus.send({
                    kind: "WANT_ATTACHMENT",
                    attachmentHash: attachmentInfo.hash,
                    doc: event.doc,
                    shareAddress: replica.share,
                  });
                }
              }

              await replica.ingest(format, event.doc as FormatDocType<F>);

              fulfilWant(event.id);

              break;
            } else {
              console.error("Was sent a doc we never asked for");
            }

            break;
          }
          case "FULFILLED":
            isPartnerFulfilled.resolve(true);
            break;

          case "EXHAUSTED_HAVES":
            gotAllPartnerHaves.resolve();
            break;

          case "WANT_ATTACHMENT":
            transferManager.handleUpload(event, replica);
            break;

          case "ABORT":
            await cancel();
        }
      },
    });

    // This is the stream of all outbound events destined for the partner SyncAgent.
    this.readable = new ReadableStream<SyncAgentEvent>({
      start(controller) {
        // Subscribe to the bus for events, and enqueue them.
        const unsub = outboundEventBus.on((event) => {
          if (
            isDoneMultiDeferred.state !== "rejected" &&
            event.kind !== "CMD_FINISHED"
          ) {
            controller.enqueue(event);
          }

          if (event.kind === "ABORT") {
            isDoneMultiDeferred.reject("Aborted");
          }

          if (event.kind === "ABORT" || event.kind === "CMD_FINISHED") {
            controller.close();
            statusBus.send(getStatus());
            unsub();
          }

          if (event.kind === "CMD_FINISHED") {
            isDoneMultiDeferred.resolve();
          }
        });
      },
    });

    this.gotAllPartnerHaves.then(() => {
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
      this.outboundEventBus.send({ kind: "FULFILLED" });
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

    await this.outboundEventBus.send({ kind: "ABORT" });
  }

  isDone() {
    return this.isDoneMultiDeferred.getPromise();
  }
}
