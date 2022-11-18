import { BlockingBus } from "../streams/stream_utils.ts";
import { AttachmentTransfer } from "./attachment_transfer.ts";
import { PromiseEnroller } from "./promise_enroller.ts";
import { AttachmentTransferReport } from "./syncer_types.ts";

export class TransferQueue {
  private waiting: AttachmentTransfer<unknown>[] = [];
  private active = new Set<AttachmentTransfer<unknown>>();
  private failed = new Set<AttachmentTransfer<unknown>>();
  private completed = new Set<AttachmentTransfer<unknown>>();

  private activeLimit: number;

  private transfersRequestedByUsEnroller = new PromiseEnroller(true);

  // This status is going to be modified a LOT so it's better to mutate than recreate from scratch.
  private reports: Record<string, Record<string, AttachmentTransferReport>> =
    {};

  private reportBus = new BlockingBus<
    Record<string, AttachmentTransferReport[]>
  >();

  constructor(activeLimit: number) {
    this.activeLimit = activeLimit;
  }

  private async activate(transfer: AttachmentTransfer<unknown>) {
    this.active.add(transfer);

    transfer.isDone().then(() => {
      this.completed.add(transfer);
    }).catch(() => {
      this.failed.add(transfer);
    }).finally(() => {
      this.active.delete(transfer);
      this.admitNext();
    });

    await transfer.start();
  }

  private queue(transfer: AttachmentTransfer<unknown>) {
    this.waiting.push(transfer);
  }

  private admitNext() {
    if (this.waiting.length === 0) {
      return;
    }

    if (this.active.size >= this.activeLimit) {
      return;
    }

    const first = this.waiting.shift();

    if (first) {
      this.activate(first);
    }
  }

  async addTransfer(transfer: AttachmentTransfer<unknown>) {
    transfer.onProgress(() => {
      this.updateTransferStatus(transfer);
    });

    if (transfer.requester === "us") {
      this.transfersRequestedByUsEnroller.enrol(transfer.isDone());
    }

    if (this.active.size < this.activeLimit) {
      await this.activate(transfer);
    } else {
      this.queue(transfer);
    }
  }

  gotAllTransfersRequestedByUs() {
    this.transfersRequestedByUsEnroller.seal();
  }

  cancel() {
    this.transfersRequestedByUsEnroller.seal();

    for (const transfer of this.active) {
      transfer.abort();
    }
  }

  private updateTransferStatus(transfer: AttachmentTransfer<unknown>) {
    const shareReports = this.reports[transfer.share];

    if (!shareReports) {
      this.reports[transfer.share] = {};
    }

    this.reports[transfer.share][transfer.hash + transfer.kind] = {
      author: transfer.doc.author,
      path: transfer.doc.path,
      format: transfer.doc.format,
      hash: transfer.hash,
      kind: transfer.kind,
      status: transfer.status,
      bytesLoaded: transfer.loaded,
      totalBytes: transfer.expectedSize,
    };

    this.reportBus.send(this.getReport());
  }

  getReport(): Record<string, AttachmentTransferReport[]> {
    const report: Record<string, AttachmentTransferReport[]> = {};

    for (const shareKey in this.reports) {
      const transferReports = [];

      const shareReport = this.reports[shareKey];

      for (const key in shareReport) {
        const transferReport = shareReport[key];
        transferReports.push(transferReport);
      }

      report[shareKey] = transferReports;
    }

    return report;
  }

  hasQueuedTransfer(hash: string, kind: "upload" | "download") {
    for (const waiting of this.waiting) {
      if (waiting.hash === hash && waiting.kind === kind) {
        return true;
      }
    }

    for (const active of this.active) {
      if (active.hash === hash && active.kind === kind) {
        return true;
      }
    }

    for (const complete of this.completed) {
      if (complete.hash === hash && complete.kind === kind) {
        return true;
      }
    }

    return false;
  }

  onReportUpdate(
    cb: (report: Record<string, AttachmentTransferReport[]>) => void,
  ) {
    return this.reportBus.on(cb);
  }

  transfersRequestedByUsFinished() {
    return this.transfersRequestedByUsEnroller.isDone();
  }
}
