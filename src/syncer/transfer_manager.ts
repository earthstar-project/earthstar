import { deferred } from "https://deno.land/std@0.150.0/async/deferred.ts";
import { ShareAddress } from "../util/doc-types.ts";
import { EarthstarError } from "../util/errors.ts";
import { AttachmentTransfer } from "./attachment_transfer.ts";
import { TransferManagerReport } from "./syncer_types.ts";

export class TransferManager {
  private waiting: AttachmentTransfer<unknown>[] = [];
  private active = new Set<AttachmentTransfer<unknown>>();
  private failed = new Set<AttachmentTransfer<unknown>>();
  private completed = new Set<AttachmentTransfer<unknown>>();

  private activeLimit: number;
  private isClosedToInternalRequests = false;

  /** Transfers with these hashes should not be added. */
  private barredHashes = new Set<string>();

  isDone = deferred<true>();

  // This status is going to be modified a LOT so it's better to mutate than recreate from scratch.
  private reports: Record<string, TransferManagerReport> = {};

  constructor(activeLimit: number) {
    this.activeLimit = activeLimit;
  }

  private activate(transfer: AttachmentTransfer<unknown>) {
    this.active.add(transfer);

    transfer.start();

    transfer.isDone.then(() => {
      this.completed.add(transfer);

      this.admit();
    }).catch(() => {
      this.failed.add(transfer);

      // If a transfer with this hash comes through again, we should allow it.
      this.barredHashes.delete(transfer.hash);
    }).finally(() => {
      this.active.delete(transfer);

      this.checkInternallyMadeTransfersFinished();
    });
  }

  private queue(transfer: AttachmentTransfer<unknown>) {
    this.waiting.push(transfer);
  }

  private admit() {
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

  private checkInternallyMadeTransfersFinished() {
    if (this.isClosedToInternalRequests === false) {
      return;
    }

    let atLeastOneInternalWaiting = false;

    for (const waiting of this.waiting) {
      if (waiting.origin === "internal") {
        atLeastOneInternalWaiting = true;
        break;
      }
    }

    if (atLeastOneInternalWaiting) {
      return;
    }

    let atLeastOneInternalActive = false;

    for (const active of this.active) {
      if (active.origin === "internal") {
        atLeastOneInternalActive = true;
        break;
      }
    }

    if (atLeastOneInternalActive) {
      return;
    }

    this.isDone.resolve();
  }

  addTransfer(transfer: AttachmentTransfer<unknown>) {
    if (this.isClosedToInternalRequests && transfer.origin === "internal") {
      throw new EarthstarError(
        "Tried to add internal transfer after transfer manager was sealed to internal transfers.",
      );
    }

    if (this.barredHashes.has(transfer.hash)) {
      return;
    }

    if (this.active.size < this.activeLimit) {
      this.activate(transfer);
    } else {
      this.queue(transfer);
    }
  }

  closeToInternalTransfers() {
    this.isClosedToInternalRequests = true;

    this.checkInternallyMadeTransfersFinished();
  }

  cancel() {
    this.isClosedToInternalRequests = true;

    for (const transfer of this.active) {
      transfer.abort();
    }

    this.isDone.reject();
  }

  getReport(share: ShareAddress): TransferManagerReport {
    return this.reports[share];
  }

  hasTransferWithHash(hash: string): boolean {
    return this.barredHashes.has(hash);
  }
}
