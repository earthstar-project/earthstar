import { deferred } from "https://deno.land/std@0.150.0/async/deferred.ts";
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
import { EarthstarError, isErr } from "../util/errors.ts";
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
  private checkedForAttachmentsEnroller = new PromiseEnroller();
  private formatsLookup: Record<string, FormatArg<FormatsType>>;
  private reportDidUpdateBus = new BlockingBus<
    Record<string, AttachmentTransferReport[]>
  >();

  constructor(
    opts: TransferManagerOpts<FormatsType, IncomingAttachmentSourceType>,
  ) {
    this.partner = opts.partner;
    this.queue = new TransferQueue(this.partner.concurrentTransfers);
    this.formats = opts.formats;
    this.formatsLookup = getFormatLookup(this.formats);

    this.checkedForAttachmentsEnroller.isDone().then(() => {
      this.queue.closeToInternalTransfers();
    });

    this.queue.onReportUpdate(async (report) => {
      await this.reportDidUpdateBus.send(report);
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

    const pipePromise = existingDocsStream.pipeTo(
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
              await handleDownload(event.doc, agent.replica);
            }
          }
        },
      }),
    );

    this.checkedForAttachmentsEnroller.enrol(pipePromise);
    this.checkedForAttachmentsEnroller.enrol(agent.isDone());
  }

  // call this when all the sync agents have been constructed
  allSyncAgentsKnown() {
    this.checkedForAttachmentsEnroller.seal();
  }

  private async queueTransfer(transfer: AttachmentTransfer<unknown>) {
    // Check if we already queued it from the queue
    if (this.queue.hasQueuedTransfer(transfer.hash, transfer.kind)) {
      return;
    }

    // Queue it up!
    await this.queue.addTransfer(transfer);
  }

  // This will be called by the sync agent
  async handleDownload(
    doc: FormatDocType<FormatsType>,
    replica: Replica,
  ): Promise<boolean> {
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
      // The sync agent will send a blob req.
      return false;
    }

    const transfer = new AttachmentTransfer({
      replica,
      doc,
      format,
      stream: result,
      origin: "internal",
    });

    await this.queueTransfer(transfer);

    // The sync agent will be happy...
    return true;
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

    if (result === undefined) {
      return false;
    }

    const format = this.formatsLookup[transferOpts.doc.format];

    try {
      const transfer = new AttachmentTransfer({
        doc: transferOpts.doc as FormatDocType<FormatsType>,
        format,
        replica,
        stream: result,
        origin: "external",
      });

      await this.queueTransfer(transfer);
    } catch {
      // This can happen if we don't have the attachment, or the doc can't have an attachment.
      return false;
    }

    return true;
  }

  async handleTransferRequest(
    { replica, path, author, source, kind, formatName }: {
      replica: Replica;
      formatName: string;
      path: Path;
      author: AuthorAddress;
      source: IncomingAttachmentSourceType;
      kind: "upload" | "download";
    },
  ) {
    const stream = await this.partner.handleTransferRequest(source, kind);

    if (stream === undefined) {
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
      origin: "external",
    });

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

  internallyMadeTransfersFinished() {
    return this.queue.internallyMadeTransfersFinished();
  }

  registerOtherSyncerId(id: string) {
    this.otherSyncerId.resolve(id);
  }
}
