import { AsyncQueue, deferred } from "../../deps.ts";
import {
  websocketReadable,
  websocketWritable,
} from "../streams/stream_utils.ts";
import { EarthstarError, NotSupportedError } from "../util/errors.ts";
import {
  GetTransferOpts,
  ISyncPartner,
  SyncAppetite,
  SyncerEvent,
} from "./syncer_types.ts";

type SyncerDriverWebServerOpts = {
  /** A websocket created from the initial sync request. */
  socket: WebSocket;
  appetite: SyncAppetite;
};

/** A syncing partner created from an inbound HTTP connection.
 * Works everywhere, but is really meant for Deno and Node.
 */
export class PartnerWebServer<
  IncomingTransferSourceType extends WebSocket,
> implements ISyncPartner<IncomingTransferSourceType> {
  concurrentTransfers = 16;
  payloadThreshold = 8;
  rangeDivision = 8;
  syncAppetite: SyncAppetite;

  private socket: WebSocket;
  private incomingQueue = new AsyncQueue<SyncerEvent>();
  private socketIsReady = deferred();

  constructor({ socket, appetite }: SyncerDriverWebServerOpts) {
    this.syncAppetite = appetite;

    if (socket.readyState === socket.OPEN) {
      this.socketIsReady.resolve();
    }

    socket.onopen = () => {
      this.socketIsReady.resolve();
    };

    this.socket = socket;

    this.socket.binaryType = "arraybuffer";

    this.socket.onmessage = (event) => {
      // Casting as string for Node's incorrect WebSocket types.
      this.incomingQueue.push(JSON.parse(event.data as string));
    };

    this.socket.onclose = () => {
      this.incomingQueue.close();
    };

    this.socket.onerror = (err) => {
      console.error(err);

      this.incomingQueue.close({
        withError: new EarthstarError("Websocket error."),
      });
    };
  }

  async sendEvent(event: SyncerEvent): Promise<void> {
    await this.socketIsReady;

    if (this.socket.readyState !== this.socket.OPEN) {
      return;
    }

    return this.socket.send(JSON.stringify(event));
  }

  getEvents(): AsyncIterable<SyncerEvent> {
    return this.incomingQueue;
  }

  closeConnection(): Promise<void> {
    this.socket.close();

    return Promise.resolve();
  }

  getDownload(
    _opts: GetTransferOpts,
  ): Promise<ReadableStream<Uint8Array> | NotSupportedError> {
    // Server can't initiate a request with a client.
    return Promise.resolve(
      new NotSupportedError(
        "SyncDriverWebServer does not support download requests.",
      ),
    );
  }

  handleUploadRequest(
    _opts: GetTransferOpts,
  ): Promise<WritableStream<Uint8Array> | NotSupportedError> {
    // Server won't get in-band BLOB_REQ messages
    return Promise.resolve(
      new NotSupportedError(
        "SyncDriverWebServer does not support upload requests.",
      ),
    );
  }

  handleTransferRequest(
    socket: IncomingTransferSourceType,
    kind: "upload" | "download",
  ): Promise<
    | ReadableStream<Uint8Array>
    | WritableStream<Uint8Array>
    | undefined
  > {
    // Return a stream which writes to the socket. nice.
    //  They want to download data from us
    if (kind === "download") {
      const writable = websocketWritable(
        socket,
        (outgoing: Uint8Array) => outgoing,
      );

      return Promise.resolve(writable);
    } else {
      // they want to upload data to us.
      const readable = websocketReadable(socket, (event) => {
        if (event.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(event.data);
          return bytes;
        }

        return null as never;
      });

      return Promise.resolve(readable);
    }
  }
}
