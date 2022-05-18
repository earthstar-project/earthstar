import { deferred } from "https://deno.land/std@0.138.0/async/deferred.ts";
import { ISyncerDriver, SyncerEvent } from "./syncer_types.ts";

type SyncerDriverWebServerOpts = {
  socket: WebSocket;
};

export class SyncerDriverWeb implements ISyncerDriver {
  readable: ReadableStream<SyncerEvent>;
  writable: WritableStream<SyncerEvent>;

  private socketIsOpen = deferred<true>();

  constructor({ socket }: SyncerDriverWebServerOpts) {
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
        socket.onmessage = (event: MessageEvent<string>) => {
          const syncEvent = JSON.parse(event.data);
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
