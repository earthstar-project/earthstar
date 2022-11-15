import { Deferred, deferred } from "../../deps.ts";
import {
  FormatArg,
  FormatDocType,
  FormatsArg,
} from "../formats/format_types.ts";
import { getFormatLookup } from "../formats/util.ts";
import { QuerySourceEvent } from "../replica/replica-types.ts";
import { Replica } from "../replica/replica.ts";
import { BlockingBus } from "../streams/stream_utils.ts";
import { AuthorAddress, Path, ShareAddress } from "../util/doc-types.ts";
import { EarthstarError, isErr, NotSupportedError } from "../util/errors.ts";
import { AttachmentTransfer } from "./attachment_transfer.ts";
import { PromiseEnroller } from "./promise_enroller.ts";
import {
  AttachmentTransferReport,
  GetTransferOpts,
  ISyncPartner,
} from "./syncer_types.ts";
import { SyncAgent } from "./sync_agent.ts";
import { TransferQueue } from "./transfer_queue.ts";

export type TransferManagerOpts<FormatsType, IncomingAttachmentSourceType> = {
  partner: ISyncPartner<IncomingAttachmentSourceType>;
  formats: FormatsArg<FormatsType>;
};

export class TransferManager<FormatsType, IncomingAttachmentSourceType> {
  private partner: ISyncPartner<IncomingAttachmentSourceType>;
  private queue: TransferQueue;
  private formats: FormatsArg<FormatsType>;
  private otherSyncerId = deferred<string>();
  private receivedAllExpectedTransfersEnroller = new PromiseEnroller();
  private madeAllAttachmentRequestsEnroller = new PromiseEnroller();
  private formatsLookup: Record<string, FormatArg<FormatsType>>;
  private reportDidUpdateBus = new BlockingBus<
    Record<string, AttachmentTransferReport[]>
  >();
  private expectedTransferPromises = new Map<string, Deferred<void>>();

  constructor(
    opts: TransferManagerOpts<FormatsType, IncomingAttachmentSourceType>,
  ) {
    this.partner = opts.partner;
    this.queue = new TransferQueue(this.partner.concurrentTransfers);
    this.formats = opts.formats;
    this.formatsLookup = getFormatLookup(this.formats);

    this.queue.onReportUpdate(async (report) => {
      await this.reportDidUpdateBus.send(report);
    });

    this.madeAllAttachmentRequestsEnroller.isDone().then(() => {
      this.receivedAllExpectedTransfersEnroller.seal();
    });

    this.receivedAllExpectedTransfersEnroller.isDone().then(() => {
      this.queue.gotAllTransfersRequestedByUs();
    });
  }

  // pass a syncagent's isDone to this
  registerSyncAgent(agent: SyncAgent<FormatsType>) {
    // create a sealed thing for when all syncagents are done syncing docs.

    const existingDocsStream = agent.replica.getQueryStream(
      { orderBy: "localIndex ASC" },
      "existing",
      this.formats,
    );

    const { formatsLookup } = this;
    const handleDownload = this.handleDownload.bind(this);

    const pipedExistingDocsToManager = existingDocsStream.pipeTo(
      new WritableStream<
        QuerySourceEvent<FormatDocType<FormatsType>>
      >({
        async write(event) {
          if (event.kind === "existing" || event.kind === "success") {
            // Get the right format here...
            const format = formatsLookup[event.doc.format];

            const res = await agent.replica.getAttachment(event.doc, format);

            if (isErr(res)) {
              // This doc can't have a attachment attached. Do nothing.
              return;
            } else if (res === undefined) {
              await handleDownload(
                event.doc,
                agent.replica,
                agent.counterpartId,
              );
            }
          }
        },
      }),
    );

    this.madeAllAttachmentRequestsEnroller.enrol(pipedExistingDocsToManager);
    this.madeAllAttachmentRequestsEnroller.enrol(agent.isDone());
  }

  // call this when all the sync agents have been constructed
  // and seal the enroller with all the piped existing docs.
  allSyncAgentsKnown() {
    this.madeAllAttachmentRequestsEnroller.seal();
  }

  registerExpectedTransfer(share: ShareAddress, hash: string) {
    const promise = deferred<void>();
    const key = `${share}_${hash}`;
    this.expectedTransferPromises.set(key, promise);

    this.receivedAllExpectedTransfersEnroller.enrol(promise);
  }

  private async queueTransfer(transfer: AttachmentTransfer<unknown>) {
    // Check if we already queued it from the queue
    if (this.queue.hasQueuedTransfer(transfer.hash, transfer.kind)) {
      return;
    }

    // Queue it up!
    await this.queue.addTransfer(transfer);
  }

  // This will be called by the sync agent.

  async handleDownload(
    doc: FormatDocType<FormatsType>,
    replica: Replica,
    counterpartId: string,
  ): Promise<NotSupportedError | "no_attachment" | "queued"> {
    const format = this.formatsLookup[doc.format];
    const attachmentInfo = format.getAttachmentInfo(doc);

    if (isErr(attachmentInfo)) {
      throw new EarthstarError(
        "TransferManager: attempted to download doc with no attachment.",
      );
    }

    const result = await this.partner.getDownload({
      doc,
      shareAddress: replica.share,
      syncerId: await this.otherSyncerId,
      attachmentHash: attachmentInfo.hash,
    });

    if (result === undefined) {
      const key = `${replica.share}_${attachmentInfo.hash}`;
      const promise = deferred<void>();
      this.expectedTransferPromises.set(key, promise);

      promise.resolve();

      // The sync agent will send a blob req.
      return "no_attachment";
    }

    if (isErr(result)) {
      return result;
    }

    const transfer = new AttachmentTransfer({
      replica,
      doc,
      format,
      stream: result,
      requester: "us",
      counterpartId,
    });

    await this.queueTransfer(transfer);

    return "queued";
  }

  async handleUpload(
    transferOpts: Omit<GetTransferOpts, "syncerId">,
    replica: Replica,
  ): Promise<boolean> {
    const result = await this.partner.handleUploadRequest({
      shareAddress: transferOpts.shareAddress,
      syncerId: await this.otherSyncerId,
      doc: transferOpts.doc,
      attachmentHash: transferOpts.attachmentHash,
    });

    if (isErr(result)) {
      return false;
    }

    const format = this.formatsLookup[transferOpts.doc.format];

    try {
      const transfer = new AttachmentTransfer({
        doc: transferOpts.doc as FormatDocType<FormatsType>,
        format,
        replica,
        stream: result,
        requester: "them",
        counterpartId: "unused", // Doesn't matter
      });

      await this.queueTransfer(transfer);
    } catch {
      // This can happen if we don't have the attachment, or the doc can't have an attachment.
      return false;
    }

    return true;
  }

  async handleTransferRequest(
    { replica, path, author, source, kind, formatName, counterpartId }: {
      replica: Replica;
      formatName: string;
      path: Path;
      author: AuthorAddress;
      source: IncomingAttachmentSourceType;
      kind: "upload" | "download";
      counterpartId: string;
    },
  ) {
    const stream = await this.partner.handleTransferRequest(source, kind);

    // This method is not supported or we just don't have the requested attachment.
    if (stream === undefined || isErr(stream)) {
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

    // got a stream! add it to the syncer's transfers.
    const transfer = new AttachmentTransfer({
      doc: doc as FormatDocType<typeof format>,
      format,
      replica,
      stream,
      requester: kind === "upload" ? "us" : "them",
      counterpartId,
    });

    if (transfer.requester === "us") {
      const key = `${transfer.share}_${transfer.hash}`;
      const promise = this.expectedTransferPromises.get(key);

      if (promise) {
        promise.resolve();
      }
    }

    await this.queueTransfer(transfer);
  }

  cancel() {
    this.queue.cancel();
  }

  getReport() {
    return this.queue.getReport();
  }

  onReportUpdate(cb: () => void) {
    return this.reportDidUpdateBus.on(cb);
  }

  transfersRequestedByUsFinished() {
    return this.queue.transfersRequestedByUsFinished();
  }

  registerOtherSyncerId(id: string) {
    this.otherSyncerId.resolve(id);
  }

  isAlreadyQueued(hash: string, kind: "upload" | "download") {
    return this.queue.hasQueuedTransfer(hash, kind);
  }
}
