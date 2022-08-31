import { ShareAddress } from "../util/doc-types.ts";
import { AttachmentTransfer } from "./attachment_transfer.ts";
import { PromiseEnroller } from "./promise_enroller.ts";
import { AttachmentTransferReport } from "./syncer_types.ts";

export class TransferQueue {
  private waiting: AttachmentTransfer<unknown>[] = [];
  private active = new Set<AttachmentTransfer<unknown>>();
  private failed = new Set<AttachmentTransfer<unknown>>();
  private completed = new Set<AttachmentTransfer<unknown>>();

  private activeLimit: number;

  private enroller = new PromiseEnroller(true);

  // This status is going to be modified a LOT so it's better to mutate than recreate from scratch.
  private reports: Record<string, Record<string, AttachmentTransferReport>> =
    {};

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

  addTransfer(transfer: AttachmentTransfer<unknown>) {
    transfer.onProgress(() => {
      this.updateTransferStatus(transfer);
    });

    if (transfer.origin === "internal") {
      this.enroller.enrol(transfer.isDone());
    }

    if (this.active.size < this.activeLimit) {
      this.activate(transfer);
    } else {
      this.queue(transfer);
    }
  }

  closeToInternalTransfers() {
    this.enroller.seal();
  }

  cancel() {
    this.enroller.seal();

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
  }

  getReports(share: ShareAddress): AttachmentTransferReport[] {
    const reports = [];

    for (const key in this.reports[share]) {
      const report = this.reports[share][key];

      reports.push(report);
    }

    return reports;
  }

  hasQueuedTransfer(hash: string, kind: "upload" | "download") {
    for (const active of this.active) {
      if (active.hash === hash && active.kind === kind) {
        return true;
      }
    }

    for (const waiting of this.waiting) {
      if (waiting.hash === hash && waiting.kind === kind) {
        return true;
      }
    }

    return false;
  }

  internallyMadeTransfersFinished() {
    return this.enroller.isDone();
  }
}
