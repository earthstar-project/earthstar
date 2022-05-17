import { IPeer } from "../peer/peer-types.ts";
import { BlockingBus } from "../streams/stream_utils.ts";
import { Syncer } from "./syncer.ts";
import { ISyncerDriver, SyncerEvent, SyncerMode } from "./syncer_types.ts";

export class SyncerDriverLocal implements ISyncerDriver {
  readable: ReadableStream<SyncerEvent>;
  writable: WritableStream<SyncerEvent>;

  private incomingEventBus = new BlockingBus<SyncerEvent>();
  private outgoingEventBus = new BlockingBus<SyncerEvent>();
  private partnerSyncer: Syncer;

  constructor(peer: IPeer, mode: SyncerMode) {
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
    this.partnerSyncer = new Syncer({
      peer,
      driver: {
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
      },
      mode,
    });
  }
}
