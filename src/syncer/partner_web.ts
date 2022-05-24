import { deferred } from "https://deno.land/std@0.138.0/async/deferred.ts";
import { ISyncPartner, SyncerEvent } from "./syncer_types.ts";

type SyncerDriverWebServerOpts = {
  socket: WebSocket;
};

export class PartnerWeb implements ISyncPartner {
  readable: ReadableStream<SyncerEvent>;
  writable: WritableStream<SyncerEvent>;

  private socketIsOpen = deferred<true>();

  constructor({ socket }: SyncerDriverWebServerOpts) {
    // Handle the case where the socket is already open when handed to this constructor.
    if (socket.readyState === WebSocket.OPEN) {
      this.socketIsOpen.resolve(true);
    }

    socket.onopen = () => this.socketIsOpen.resolve(true);

    const { socketIsOpen } = this;

    this.writable = new WritableStream({
      async write(event) {
        await socketIsOpen;

        socket.send(JSON.stringify(event));
      },
      close() {
        socket.close();
      },
      abort() {
        socket.close();
      },
    });

    this.readable = new ReadableStream({
      start(controller) {
        socket.onmessage = (event) => {
          const syncEvent = JSON.parse(event.data.toString());
          controller.enqueue(syncEvent);
        };

        socket.onclose = () => {
          controller.close();
        };

        socket.onerror = (err) => {
          controller.error(err);
        };
      },
    });
  }
}
