import { AsyncQueue } from "../../deps.ts";
import { FormatsArg } from "../formats/format_types.ts";
import { IPeer } from "../peer/peer-types.ts";
import { isErr } from "../util/errors.ts";
import { ValidationError } from "../util/errors.ts";
import { Syncer } from "./syncer.ts";
import {
  GetTransferOpts,
  ISyncPartner,
  SyncerEvent,
  SyncerMode,
} from "./syncer_types.ts";

/** A syncing partner to be used with local instances of `IPeer`.
 * Works everywhere.
 */
export class PartnerLocal<
  FormatsType,
  IncomingTransferSourceType extends undefined,
> implements ISyncPartner<undefined> {
  concurrentTransfers = 1024;

  private outgoingQueue = new AsyncQueue<SyncerEvent>();
  private incomingQueue = new AsyncQueue<SyncerEvent>();

  private partnerPeer: IPeer;

  // Need this for testing.
  partnerSyncer: Syncer<IncomingTransferSourceType, FormatsType>;

  /**
   * @param peer - The target peer to sync with.
   * @param peerSelf - Our own peer.
   */
  constructor(
    peer: IPeer,
    peerSelf: IPeer,
    mode: SyncerMode,
    formats?: FormatsArg<FormatsType>,
  ) {
    this.partnerPeer = peer;

    const { incomingQueue, outgoingQueue } = this;

    // This is a bit confusing, but it does work.

    // This will be the partner of our partner, which is us.

    // Now we create another syncer within this driver
    // But this syncer needs its own driver...
    // We'll give it one that proxies to the readable / writable pair we defined above.

    this.partnerSyncer = new Syncer<IncomingTransferSourceType, FormatsType>({
      peer,
      formats,
      partner: {
        getEvents() {
          return incomingQueue;
        },
        sendEvent(event) {
          outgoingQueue.push(event);
          return Promise.resolve();
        },
        concurrentTransfers: 1024,
        async getDownload(
          opts: GetTransferOpts,
        ): Promise<ReadableStream<Uint8Array> | undefined> {
          const partnerReplica = peerSelf.getReplica(opts.shareAddress);

          if (!partnerReplica) {
            throw new ValidationError(
              "Tried to get a receiving transfer for an unknown share.",
            );
          }

          const attachment = await partnerReplica.replicaDriver.attachmentDriver
            .getAttachment(
              opts.doc.format,
              opts.attachmentHash,
            );

          if (!attachment) {
            return undefined;
          }

          if (isErr(attachment)) {
            return;
          }

          return await attachment.stream();
        },
        handleUploadRequest(
          _opts: GetTransferOpts,
        ): Promise<WritableStream<Uint8Array> | undefined> {
          // Just return undefined here because we know how to directly get a transfer from this partner.
          return Promise.resolve(undefined);
        },
        handleTransferRequest(
          _source: IncomingTransferSourceType,
          _kind: "upload" | "download",
        ): Promise<
          | ReadableStream<Uint8Array>
          | WritableStream<Uint8Array>
          | undefined
        > {
          // Don't need to implement this either.
          return Promise.resolve(undefined);
        },
      },
      mode,
    });
  }

  getEvents(): AsyncIterable<SyncerEvent> {
    return this.outgoingQueue;
  }

  sendEvent(event: SyncerEvent): Promise<void> {
    this.incomingQueue.push(event);

    return Promise.resolve();
  }

  async getDownload(
    opts: GetTransferOpts,
  ): Promise<ReadableStream<Uint8Array> | undefined> {
    const partnerReplica = this.partnerPeer.getReplica(opts.shareAddress);

    if (!partnerReplica) {
      throw new ValidationError(
        "Tried to get a receiving transfer for an unknown share.",
      );
    }

    const attachment = await partnerReplica.replicaDriver.attachmentDriver
      .getAttachment(
        opts.doc.format,
        opts.attachmentHash,
      );

    if (!attachment) {
      return undefined;
    }

    if (isErr(attachment)) {
      return;
    }

    return await attachment.stream();
  }

  handleUploadRequest(
    _opts: GetTransferOpts,
  ): Promise<WritableStream<Uint8Array> | undefined> {
    // Just return undefined here because we know how to directly get a transfer from this partner.
    return Promise.resolve(undefined);
  }

  handleTransferRequest(
    _source: IncomingTransferSourceType,
    _kind: "upload" | "download",
  ): Promise<
    | ReadableStream<Uint8Array>
    | WritableStream<Uint8Array>
    | undefined
  > {
    // Don't need to implement this either.
    return Promise.resolve(undefined);
  }
}
