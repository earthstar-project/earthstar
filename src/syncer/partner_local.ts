import { AsyncQueue } from "../../deps.ts";
import { FormatsArg } from "../formats/format_types.ts";
import { IPeer } from "../peer/peer-types.ts";
import { isErr, NotSupportedError } from "../util/errors.ts";
import { ValidationError } from "../util/errors.ts";
import { Syncer } from "./syncer.ts";
import { SyncerManager } from "./syncer_manager.ts";
import {
  GetTransferOpts,
  ISyncPartner,
  SyncAppetite,
  SyncerEvent,
} from "./syncer_types.ts";

/** A syncing partner to be used with local instances of `IPeer`.
 * Works everywhere.
 */
export class PartnerLocal<
  FormatsType,
  IncomingTransferSourceType extends undefined,
> implements ISyncPartner<undefined> {
  concurrentTransfers = 1024;
  payloadThreshold = 1;
  rangeDivision = 2;
  syncAppetite: SyncAppetite;

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
    appetite: SyncAppetite,
    formats?: FormatsArg<FormatsType>,
  ) {
    this.syncAppetite = appetite;
    this.partnerPeer = peer;

    const { incomingQueue, outgoingQueue } = this;

    // This is a bit confusing, but it does work.

    // This will be the partner of our partner, which is us.

    // Now we create another syncer within this driver
    // But this syncer needs its own driver...
    // We'll give it one that proxies to the readable / writable pair we defined above.

    this.partnerSyncer = new Syncer<IncomingTransferSourceType, FormatsType>({
      manager: (peer as any).syncerManager,
      formats,
      partner: {
        syncAppetite: appetite,
        getEvents() {
          return incomingQueue;
        },
        sendEvent(event) {
          outgoingQueue.push(event);
          return Promise.resolve();
        },
        concurrentTransfers: 1024,
        payloadThreshold: 32,
        rangeDivision: 32,
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
        closeConnection() {
          outgoingQueue.close();

          return Promise.resolve();
        },
        handleUploadRequest(
          _opts: GetTransferOpts,
        ): Promise<WritableStream<Uint8Array> | NotSupportedError> {
          return Promise.resolve(
            new NotSupportedError("PartnerLocal does not support uploads."),
          );
        },
        handleTransferRequest(
          _source: IncomingTransferSourceType,
          _kind: "upload" | "download",
        ): Promise<
          | ReadableStream<Uint8Array>
          | WritableStream<Uint8Array>
          | undefined
          | NotSupportedError
        > {
          // Don't need to implement this either.
          return Promise.resolve(
            new NotSupportedError(
              "PartnerLocal does not support transfer requests.",
            ),
          );
        },
      },
    });
  }

  getEvents(): AsyncIterable<SyncerEvent> {
    return this.outgoingQueue;
  }

  sendEvent(event: SyncerEvent): Promise<void> {
    this.incomingQueue.push(event);

    return Promise.resolve();
  }

  closeConnection(): Promise<void> {
    this.incomingQueue.close();

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
  ): Promise<WritableStream<Uint8Array> | NotSupportedError> {
    // Just return undefined here because we know how to directly get a transfer from this partner.
    return Promise.resolve(
      new NotSupportedError("PartnerLocal does not support uploads."),
    );
  }

  handleTransferRequest(
    _source: IncomingTransferSourceType,
    _kind: "upload" | "download",
  ): Promise<
    | ReadableStream<Uint8Array>
    | WritableStream<Uint8Array>
    | undefined
    | NotSupportedError
  > {
    // Don't need to implement this either.
    return Promise.resolve(
      new NotSupportedError("PartnerLocal does not support transfer requests."),
    );
  }
}
