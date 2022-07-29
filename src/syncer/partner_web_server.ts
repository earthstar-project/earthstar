import { deferred } from "https://deno.land/std@0.138.0/async/deferred.ts";
import { ValidationError } from "../util/errors.ts";
import { sleep } from "../util/misc.ts";
import { GetTransferOpts, ISyncPartner, SyncerEvent } from "./syncer_types.ts";

type SyncerDriverWebServerOpts = {
  socket: WebSocket;
};

export class PartnerWebServer<
  IncomingTransferSourceType extends WebSocket,
> implements ISyncPartner<IncomingTransferSourceType> {
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

  getDownload(
    _opts: GetTransferOpts,
  ): Promise<ReadableStream<Uint8Array> | ValidationError | undefined> {
    // Server can't initiate a request with a client.
    return Promise.resolve(undefined);
  }

  handleUploadRequest(
    _opts: GetTransferOpts,
  ): Promise<WritableStream<Uint8Array> | ValidationError | undefined> {
    // Server won't get in-band BLOB_REQ messages
    return Promise.resolve(undefined);
  }

  handleTransferRequest(
    socket: IncomingTransferSourceType,
    kind: "upload" | "download",
  ): Promise<
    | ReadableStream<Uint8Array>
    | WritableStream<Uint8Array>
    | ValidationError
    | undefined
  > {
    // Return a stream which writes to the socket. nice.
    const socketIsOpen = deferred();

    socket.binaryType = "arraybuffer";

    socket.onopen = () => {
      socketIsOpen.resolve();
    };

    //  They want to download data from us
    if (kind === "download") {
      const writable = new WritableStream<Uint8Array>({
        async write(chunk) {
          await socketIsOpen;

          socket.send(chunk.buffer);
        },
        close() {
          socket.close();
        },
      });

      return Promise.resolve(writable);
    } else {
      // they want to upload data to us.
      const readable = new ReadableStream<Uint8Array>({
        start(controller) {
          socket.onmessage = (event) => {
            if (event.data instanceof ArrayBuffer) {
              const bytes = new Uint8Array(event.data);

              controller.enqueue(bytes);
            }
          };

          socket.onclose = () => {
            controller.close();
          };

          socket.onerror = (err) => {
            controller.error(err);
          };
        },
      });

      return Promise.resolve(readable);
    }
  }
}
