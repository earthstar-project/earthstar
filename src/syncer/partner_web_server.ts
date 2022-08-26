import {
  websocketReadable,
  websocketWritable,
} from "../streams/stream_utils.ts";
import { ValidationError } from "../util/errors.ts";
import { GetTransferOpts, ISyncPartner, SyncerEvent } from "./syncer_types.ts";

type SyncerDriverWebServerOpts = {
  /** A websocket created from the initial sync request. */
  socket: WebSocket;
};

/** A syncing partner created from an inbound HTTP connection.
 * Works everywhere, but is really meant for Deno and Node.
 */
export class PartnerWebServer<
  IncomingTransferSourceType extends WebSocket,
> implements ISyncPartner<IncomingTransferSourceType> {
  readable: ReadableStream<SyncerEvent>;
  writable: WritableStream<SyncerEvent>;

  constructor({ socket }: SyncerDriverWebServerOpts) {
    this.writable = websocketWritable(
      socket,
      (outgoing: SyncerEvent) => {
        return JSON.stringify(outgoing);
      },
    );
    this.readable = websocketReadable(
      socket,
      (incoming) => {
        return JSON.parse(incoming.data.toString());
      },
    );
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
