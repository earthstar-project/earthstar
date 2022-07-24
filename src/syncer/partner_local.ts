import { FormatsArg } from "../formats/default.ts";
import { IPeer } from "../peer/peer-types.ts";
import { BlockingBus } from "../streams/stream_utils.ts";
import { ShareAddress } from "../util/doc-types.ts";
import { Syncer } from "./syncer.ts";
import { ISyncPartner, SyncerEvent, SyncerMode } from "./syncer_types.ts";

export class PartnerLocal<F> implements ISyncPartner {
  readable: ReadableStream<SyncerEvent>;
  writable: WritableStream<SyncerEvent>;

  private incomingEventBus = new BlockingBus<SyncerEvent>();
  private outgoingEventBus = new BlockingBus<SyncerEvent>();
  partnerSyncer: Syncer<F>;

  constructor(
    peer: IPeer,
    peerSelf: IPeer,
    mode: SyncerMode,
    formats?: FormatsArg<F>,
  ) {
    const { incomingEventBus, outgoingEventBus } = this;

    // This is a bit confusing, but it does work.

    // We subscribe this driver's readable stream of outgoing events to our outgoing event bus.
    this.readable = new ReadableStream<SyncerEvent>({
      start(controller) {
        outgoingEventBus.on((event) => {
          controller.enqueue(event);
        });
      },
    });

    // We make the writable stream of incoming events write to the incoming event bus.
    this.writable = new WritableStream<SyncerEvent>({
      async write(event) {
        await incomingEventBus.send(event);
      },
    });

    // Now we create another syncer within this driver
    // But this syncer needs its own driver...
    // We'll give it one that proxies to the readable / writable pair we defined above.
    this.partnerSyncer = new Syncer<F>({
      peer,
      formats,
      partner: {
        // Events written by the partner syncer will be sent to the outgoing event bus
        // And thus to the readable stream.
        writable: new WritableStream({
          async write(event) {
            await outgoingEventBus.send(event);
          },
        }),
        // Events sent to the incoming event bus will be sent to the readable stream here.
        readable: new ReadableStream({
          start(controller) {
            incomingEventBus.on((event) => {
              controller.enqueue(event);
            });
          },
        }),
        async getBlobStream(share: ShareAddress, signature: string) {
          const replica = peerSelf.getReplica(share);

          if (!replica) {
            return undefined;
          }

          const blob = await replica.replicaDriver.blobDriver.getBlob(
            signature,
          );

          if (!blob) {
            return undefined;
          }

          return blob.stream;
        },
      },
      mode,
    });
  }

  async getBlobStream(
    share: ShareAddress,
    signature: string,
  ): Promise<ReadableStream<Uint8Array> | undefined> {
    const replica = this.partnerSyncer.peer.getReplica(share);

    if (!replica) {
      return undefined;
    }

    const blob = await replica.replicaDriver.blobDriver.getBlob(signature);

    if (!blob) {
      return undefined;
    }

    return blob.stream;
  }
}
