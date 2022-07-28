import { deferred } from "https://deno.land/std@0.138.0/async/deferred.ts";
import { ValidationError } from "../util/errors.ts";
import { GetTransferOpts, ISyncPartner, SyncerEvent } from "./syncer_types.ts";

type SyncerDriverWebClientOpts = {
  url: string;
};

export class PartnerWebClient<
  IncomingTransferSourceType extends undefined,
> implements ISyncPartner<undefined> {
  readable: ReadableStream<SyncerEvent>;
  writable: WritableStream<SyncerEvent>;

  private socketIsOpen = deferred<true>();
  private isSecure: boolean;
  private url: URL;

  constructor(opts: SyncerDriverWebClientOpts) {
    // Check if it's a URL of some kind.
    this.url = new URL(opts.url);

    // Check if it's a web syncer
    const hostAndPath = `${this.url.host}${this.url.pathname}`;

    this.isSecure = this.url.protocol === "https" ||
      this.url.protocol === "wss";

    const socket = new WebSocket(
      this.isSecure ? `wss://${hostAndPath}` : `ws://${hostAndPath}`,
    );

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
    opts: GetTransferOpts,
  ): Promise<ReadableStream<Uint8Array> | ValidationError | undefined> {
    // create a new url with the share, path, and syncer ID embedded

    const hostAndPath =
      `${this.url.host}/download/${opts.syncerId}/${opts.shareAddress}/${opts.signature}`;

    const socket = new WebSocket(
      this.isSecure ? `wss://${hostAndPath}` : `ws://${hostAndPath}`,
    );

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

  handleUploadRequest(
    opts: GetTransferOpts,
  ): Promise<WritableStream<Uint8Array> | ValidationError | undefined> {
    const hostAndPath =
      `${this.url.host}/upload/${opts.syncerId}/${opts.shareAddress}/${opts.signature}`;

    const socket = new WebSocket(
      this.isSecure ? `wss://${hostAndPath}` : `ws://${hostAndPath}`,
    );

    // Return a stream which writes to the socket. nice.
    const socketIsOpen = deferred();

    socket.onopen = () => {
      socketIsOpen.resolve();
    };

    const writable = new WritableStream<Uint8Array>({
      async write(chunk) {
        await socketIsOpen;

        socket.send(chunk);
      },
    });

    return Promise.resolve(writable);
  }

  handleTransferRequest(
    _source: IncomingTransferSourceType,
    _kind: "upload" | "download",
  ): Promise<
    | ReadableStream<Uint8Array>
    | WritableStream<Uint8Array>
    | ValidationError
    | undefined
  > {
    return Promise.resolve(undefined);
  }
}
