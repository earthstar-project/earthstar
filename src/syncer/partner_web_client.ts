import {
  websocketReadable,
  websocketWritable,
} from "../streams/stream_utils.ts";
import { ValidationError } from "../util/errors.ts";
import {
  GetTransferOpts,
  ISyncPartner,
  SyncerEvent,
  SyncerMode,
} from "./syncer_types.ts";

type SyncerDriverWebClientOpts = {
  /** The URL of the replica server to sync with. */
  url: string;
  mode: SyncerMode;
};

/** A syncing partner to be used with replica servers reachable via the internet.
 * Works everywhere.
 */
export class PartnerWebClient<
  IncomingTransferSourceType extends undefined,
> implements ISyncPartner<undefined> {
  readable: ReadableStream<SyncerEvent>;
  writable: WritableStream<SyncerEvent>;

  private isSecure: boolean;
  private url: URL;

  constructor(opts: SyncerDriverWebClientOpts) {
    // Check if it's a URL of some kind.
    this.url = new URL(opts.url);

    // Check if it's a web syncer
    const hostAndPath = `${this.url.host}${this.url.pathname}`;

    this.isSecure = this.url.protocol === "https:" ||
      this.url.protocol === "wss:";

    const socket = new WebSocket(
      this.isSecure
        ? `wss://${hostAndPath}/${opts.mode}`
        : `ws://${hostAndPath}/${opts.mode}`,
    );

    this.writable = websocketWritable(
      socket,
      (outgoing: SyncerEvent) => JSON.stringify(outgoing),
    );
    this.readable = websocketReadable(
      socket,
      (incoming) => JSON.parse(incoming.data.toString()),
    );
  }

  getDownload(
    opts: GetTransferOpts,
  ): Promise<ReadableStream<Uint8Array> | ValidationError | undefined> {
    // create a new url with the share, path, and syncer ID embedded

    const hostAndPath =
      `${this.url.host}${this.url.pathname}/${opts.syncerId}/download/${opts.shareAddress}/${opts.doc.format}/${opts.doc.author}${opts.doc.path}`;

    const socket = new WebSocket(
      this.isSecure ? `wss://${hostAndPath}` : `ws://${hostAndPath}`,
    );

    const readable = websocketReadable(socket, (event) => {
      if (event.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(event.data);
        return bytes;
      }

      return null as never;
    });

    return Promise.resolve(readable);
  }

  handleUploadRequest(
    opts: GetTransferOpts,
  ): Promise<WritableStream<Uint8Array> | ValidationError | undefined> {
    const hostAndPath =
      `${this.url.host}${this.url.pathname}/${opts.syncerId}/upload/${opts.shareAddress}/${opts.doc.format}/${opts.doc.author}${opts.doc.path}`;

    const socket = new WebSocket(
      this.isSecure ? `wss://${hostAndPath}` : `ws://${hostAndPath}`,
    );

    const writable = websocketWritable(
      socket,
      (outgoing: Uint8Array) => outgoing,
    );

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
    // We don't expect any external requests.
    return Promise.resolve(undefined);
  }
}
