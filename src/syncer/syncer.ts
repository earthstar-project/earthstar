import { deferred } from "https://deno.land/std@0.138.0/async/deferred.ts";
import { Crypto } from "../crypto/crypto.ts";
import {
  DEFAULT_FORMAT,
  getFormatIntersection,
  getFormatLookup,
  getFormatsWithFallback,
} from "../formats/util.ts";
import {
  DefaultFormats,
  FormatDocType,
  FormatsArg,
} from "../formats/format_types.ts";
import { IPeer } from "../peer/peer-types.ts";
import { QuerySourceEvent } from "../replica/replica-types.ts";
import {
  BlockingBus,
  CloneStream,
  StreamSplitter,
} from "../streams/stream_utils.ts";
import { AuthorAddress, Path, ShareAddress } from "../util/doc-types.ts";
import { isErr } from "../util/errors.ts";
import { randomId } from "../util/misc.ts";
import { AttachmentTransfer } from "./attachment_transfer.ts";
import {
  ISyncPartner,
  SyncAgentEvent,
  SyncerEvent,
  SyncerMode,
  SyncerOpts,
  SyncerStatus,
} from "./syncer_types.ts";
import { SyncAgent } from "./sync_agent.ts";

/** Syncs the contents of a Peer's replicas with that of another peer's.  */
export class Syncer<IncomingTransferSourceType, FormatsType = DefaultFormats> {
  peer: IPeer;
  id = randomId();
  private partner: ISyncPartner<IncomingTransferSourceType>;
  private outgoingEventBus = new BlockingBus<SyncerEvent>();
  private syncAgents = new Map<ShareAddress, SyncAgent<FormatsType>>();
  private docStreams = new Map<
    ShareAddress,
    {
      existing: ReadableStream<QuerySourceEvent<FormatDocType<FormatsType>>>;
    }
  >();
  private mode: SyncerMode;
  private incomingStreamCloner = new CloneStream<SyncerEvent>();
  private statusBus = new BlockingBus<SyncerStatus>();
  private agentStreamSplitter = new StreamSplitter<SyncerEvent>((chunk) => {
    if (
      chunk.kind === "DISCLOSE" || chunk.kind === "BLOB_REQ" ||
      chunk.kind === "SYNCER_DONE"
    ) {
      return;
    }

    return chunk.to;
  });
  private formats: FormatsArg<FormatsType>;
  private transfers = new Map<
    ShareAddress,
    Map<string, AttachmentTransfer<FormatsType>>
  >();

  private docSyncIsDone = deferred<true>();
  private checkedAllExistingDocsForAttachments = deferred<true>();
  private transfersAreDone = deferred<true>();
  private partnerIsDone = deferred<true>();

  /** If the syncer was configured with the `mode: 'once'`, this promise will resolve when all the partner's existing documents and attachments have synchronised. */
  isDone = deferred<true>();

  constructor(opts: SyncerOpts<FormatsType, IncomingTransferSourceType>) {
    // Have to do this because we'll be using these values in a context where 'this' is different
    // (the streams below)
    const { outgoingEventBus } = this;
    const handleIncomingEvent = this.handleIncomingEvent.bind(this);

    this.peer = opts.peer;

    this.mode = opts.mode;
    this.formats = getFormatsWithFallback(opts.formats);
    this.partner = opts.partner;

    const abortController = new AbortController();

    // Create a new readable stream which is subscribed to events from this syncer.
    // Pipe it to the outgoing stream to the other peer.
    const outgoingStream = new ReadableStream({
      start(controller) {
        outgoingEventBus.on((event) => {
          controller.enqueue(event);
        });
      },
    });

    outgoingStream.pipeTo(opts.partner.writable, {
      signal: abortController.signal,
    }).catch(() => {
      // We'll abort the signal eventually, so we catch that here.
    });

    // Create a sink to handle incoming events, pipe the readable into that
    opts.partner.readable.pipeTo(this.incomingStreamCloner.writable);

    const incomingClone = this.incomingStreamCloner.getReadableStream();

    incomingClone.pipeTo(
      new WritableStream({
        async write(event) {
          await handleIncomingEvent(event);
        },
      }),
    );

    const incomingCloneForAgents = this.incomingStreamCloner
      .getReadableStream();

    // TODO: This cloner pipes all events, so if a replica is removed and re-added to a peer, it will get events intended for a previous sync agent. Which shouldn't be a problem, but it'd be better if it didn't.
    incomingCloneForAgents.pipeTo(this.agentStreamSplitter.writable);

    // Send off a salted handshake event
    const salt = randomId();
    Promise.all(
      this.peer.shares().map((ws) => saltAndHashShare(salt, ws)),
    ).then((saltedShares) => {
      outgoingEventBus.send({
        kind: "DISCLOSE",
        salt,
        shares: saltedShares,
        formats: this.formats
          ? this.formats.map((f) => f.id)
          : [DEFAULT_FORMAT.id],
      });
    });

    // If the syncer is in done mode, it should abort its outgoing stream when all sync agents are done.
    this.statusBus.on(async (status) => {
      if (this.mode === "live") {
        return;
      }

      const statuses = [] as SyncerStatus[string][];

      for (const addr in status) {
        statuses.push(status[addr]);
      }

      if (
        this.docSyncIsDone.state !== "fulfilled" &&
        statuses.every((status) => status.docs.status === "done")
      ) {
        this.docSyncIsDone.resolve(true);
      }

      if (
        this.docSyncIsDone.state === "fulfilled" &&
        this.transfersAreDone.state !== "fulfilled"
      ) {
        await this.checkedAllExistingDocsForAttachments;

        const allAttachmentsDone = Array.from(this.transfers.values()).flatMap((
          t,
        ) => Array.from(t.values())).map((transfer) => transfer.isDone);

        await Promise.all(allAttachmentsDone);

        this.transfersAreDone.resolve(true);
      }
    });

    this.transfersAreDone.then(async () => {
      await this.outgoingEventBus.send({
        kind: "SYNCER_DONE",
      });
    });

    this.partnerIsDone.then(async () => {
      await this.docSyncIsDone;
      await this.checkedAllExistingDocsForAttachments;
      await this.transfersAreDone;
      abortController.abort();
      this.isDone.resolve();
    });

    /*
    this.peer.onReplicasChange(() => {
      // send out disclose event again
      const salt = randomId();
      Promise.all(
        this.peer.shares().map((ws) => saltAndHashShare(salt, ws)),
      ).then((saltedShares) => {
        outgoingEventBus.send({
          kind: "DISCLOSE",
          salt,
          shares: saltedShares,
          formats: this.formats
            ? this.formats.map((f) => f.id)
            : [DefaultFormat.id],
        });
      });
    });
    */
  }

  private addShare(address: string, formats: FormatsArg<FormatsType>) {
    // Bail if we already have a sync agent for this share.
    if (this.syncAgents.has(address)) {
      return;
    }

    const replica = this.peer.getReplica(address);

    if (!replica) {
      console.error(
        "Couldn't get the replica for a share we had in common.",
      );
      return;
    }

    const onRequestAttachment = async (doc: FormatDocType<FormatsType>) => {
      const format = lookup[doc.format];

      const attachmentInfo = format.getAttachmentInfo(doc);

      if (isErr(attachmentInfo)) {
        // shouldn't happen, but...
        return;
      }

      // Check if there's already a transfer for this attachment in progress...
      const existingTransfer = transfers.get(replica.share)?.get(
        attachmentInfo.hash,
      );

      if (existingTransfer) {
        return;
      }

      // This doc can have a attachment attached, but we don't have it.
      // Ask our partner to fulfil it.

      const result = await partner.getDownload({
        doc: doc,
        shareAddress: replica.share,
        syncerId: id,
        attachmentHash: attachmentInfo.hash,
      });

      // the result is:
      // The partner has no way to get a receiving transfer. We must ask for one...
      // ... and hope that the transfer comes from without..

      if (result === undefined) {
        await outgoingEventBus.send({
          kind: "BLOB_REQ",
          shareAddress: replica.share,
          syncerId: id,
          doc: doc,
          attachmentHash: attachmentInfo.hash,
        });
        return;
      }

      // We got an error - e.g. some kind of unexpected failure. shit happens.
      if (isErr(result)) {
        return;
      }

      // We got a transfer! Add it to our syncer's transfers.

      const transfer = new AttachmentTransfer({
        replica,
        doc: doc,
        format,
        stream: result,
      });

      addTransfer(replica.share, transfer);
    };

    const agent = new SyncAgent({
      replica,
      mode: this.mode === "once" ? "only_existing" : "live",
      formats,
      onRequestAttachment,
    });

    agent.onStatusUpdate(() => {
      this.statusBus.send(this.getStatus());
    });

    this.syncAgents.set(address, agent);

    // Have to do this because we'll be using these values in a context where 'this' is different
    // (the streams below)
    const { outgoingEventBus, transfers } = this;

    // Pipe the agent's outgoing events into our event bus so they'll be sent out.
    agent.readable.pipeTo(
      new WritableStream({
        async write(event) {
          await outgoingEventBus.send({
            ...event,
            to: replica.share,
          });
        },
      }),
    ).then(() => {
      // Sticking a pin here 'cos it's handy.
      // The sync agent will finish here if in 'only_existing' mode.
    });

    const incomingFilteredEvents = this.agentStreamSplitter.getReadable(
      replica.share,
    );

    incomingFilteredEvents.pipeThrough(
      new TransformStream<SyncerEvent, SyncAgentEvent>({
        transform(event, controller) {
          switch (event.kind) {
            case "DISCLOSE":
            case "BLOB_REQ":
            case "SYNCER_DONE":
              break;
            default: {
              if (event.to === replica.share) {
                const { to: _to, ...agentEvent } = event;
                controller.enqueue(agentEvent);
                break;
              }
            }
          }
        },
      }),
    ).pipeTo(agent.writable);

    const { partner, id } = this;
    const addTransfer = this.addTransfer.bind(this);

    const lookup = getFormatLookup(formats);

    const makeAttachmentRequestSink = () =>
      new WritableStream<
        QuerySourceEvent<FormatDocType<FormatsType>>
      >({
        async write(event) {
          if (event.kind === "existing" || event.kind === "success") {
            // Get the right format here...
            const format = lookup[event.doc.format];

            const res = await replica.getAttachment(event.doc, format);

            if (isErr(res)) {
              // This doc can't have a attachment attached. Do nothing.
              return;
            } else if (res === undefined) {
              onRequestAttachment(event.doc);
            }
          }
        },
      });

    const existingDocsStream = replica.getQueryStream(
      { orderBy: "localIndex ASC" },
      "existing",
      this.formats,
    );

    existingDocsStream.pipeTo(makeAttachmentRequestSink()).then(() => {
      this.checkedAllExistingDocsForAttachments.resolve();
    });

    this.docStreams.set(address, {
      existing: existingDocsStream,
    });
  }

  /** Handle inbound events from the other peer. */
  private async handleIncomingEvent(event: SyncerEvent) {
    // Handle an incoming salted handsake
    switch (event.kind) {
      case "DISCLOSE": {
        const intersectingFormats = getFormatIntersection(
          event.formats,
          this.formats,
        );

        if (intersectingFormats.length === 0) {
          break;
        }

        const serverSaltedSet = new Set<string>(event.shares);
        const commonShareSet = new Set<ShareAddress>();

        // For each of our own shares, hash with the salt given to us by the event
        // If it matches any of the hashes sent by the other side, we have a share in common.
        for (const plainWs of this.peer.shares()) {
          const saltedWs = await saltAndHashShare(event.salt, plainWs);
          if (serverSaltedSet.has(saltedWs)) {
            commonShareSet.add(plainWs);
          }
        }

        for (const share of commonShareSet) {
          this.addShare(share, intersectingFormats);
        }
        break;
      }
      case "BLOB_REQ": {
        // ask the partner for a send transfer, add it to our send transfers.
        const result = await this.partner.handleUploadRequest({
          shareAddress: event.shareAddress,
          syncerId: event.syncerId,
          doc: event.doc,
          attachmentHash: event.attachmentHash,
        });

        // got some kind of failure, oops.
        if (isErr(result)) {
          return;
        }

        // or can't get it, oh well.
        if (result === undefined) {
          return;
        }

        const replica = this.peer.getReplica(event.shareAddress);

        if (!replica) {
          return;
        }

        const format = getFormatLookup(this.formats)[event.doc.format];

        // got a writable stream! add it to the syncer's transfers.
        const transfer = new AttachmentTransfer({
          doc: event.doc as FormatDocType<FormatsType>,
          format,
          replica,
          stream: result,
        });

        this.addTransfer(event.shareAddress, transfer);
        break;
      }
      case "SYNCER_DONE": {
        this.partnerIsDone.resolve();
      }
    }
  }

  private addTransfer(
    shareAddress: string,
    transfer: AttachmentTransfer<FormatsType>,
  ) {
    const existingMap = this.transfers.get(shareAddress);

    if (existingMap) {
      existingMap.set(transfer.hash, transfer);
    } else {
      const map = new Map();
      map.set(transfer.hash, transfer);
      this.transfers.set(shareAddress, map);
    }

    transfer.onProgress(() => {
      this.statusBus.send(this.getStatus());
    });

    this.statusBus.send(this.getStatus());
  }

  /** Get the status of all shares' syncing progress. */
  getStatus(): SyncerStatus {
    const status: SyncerStatus = {};

    for (const [shareAddr, agent] of this.syncAgents) {
      const transfers = this.transfers.get(shareAddr);

      const transferStatuses = [];

      for (const [, transfer] of transfers || []) {
        transferStatuses.push({
          author: transfer.doc.author,
          path: transfer.doc.path,
          format: transfer.doc.format,
          hash: transfer.hash,
          status: transfer.status,
          bytesLoaded: transfer.loaded,
          totalBytes: transfer.expectedSize,
          kind: transfer.kind,
        });
      }

      status[shareAddr] = {
        docs: agent.getStatus(),
        attachments: transferStatuses,
      };
    }

    return status;
  }

  /** Fires the provided callback whenever any shares' syncing progress changes. */
  onStatusChange(callback: (status: SyncerStatus) => void): () => void {
    return this.statusBus.on(callback);
  }

  /** Stop syncing. */
  cancel() {
    for (const [_addr, agent] of this.syncAgents) {
      agent.cancel();
    }

    // TODO: cancel all the doc streams used for attachments
  }

  // externally callable... to get a readable...
  async handleTransferRequest(
    { shareAddress, path, author, source, kind, formatName }: {
      shareAddress: string;
      formatName: string;
      path: Path;
      author: AuthorAddress;
      source: IncomingTransferSourceType;
      kind: "upload" | "download";
    },
  ) {
    const result = await this.partner.handleTransferRequest(source, kind);

    if (isErr(result)) {
      // pity.
      return;
    }

    // or can't get it, oh well.
    if (result === undefined) {
      return;
    }

    const replica = this.peer.getReplica(shareAddress);

    if (!replica) {
      return;
    }

    const format = getFormatLookup(this.formats)[formatName];

    if (!format) {
      return;
    }

    const docs = await replica.getAllDocsAtPath(path, [format]);
    const doc = docs.find((doc) => doc.author === author);

    if (!doc) {
      return;
    }

    // got a writable stream! add it to the syncer's transfers.
    const transfer = new AttachmentTransfer({
      doc: doc as FormatDocType<typeof format>,
      format,
      replica,
      stream: result,
    });

    this.addTransfer(shareAddress, transfer);
  }
}

function saltAndHashShare(
  salt: string,
  share: ShareAddress,
): Promise<string> {
  return Crypto.sha256base32(salt + share + salt);
}
