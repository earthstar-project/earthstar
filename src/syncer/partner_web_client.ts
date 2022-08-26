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

  concurrentTransfers = 16;

  private isSecure: boolean;
  private wsUrl: URL;

  constructor(opts: SyncerDriverWebClientOpts) {
    // Check if it's a URL of some kind.
    const url = new URL(opts.url);

    // Check if it's a web syncer
    const hostAndPath = `${url.host}${url.pathname}`;

    this.isSecure = url.protocol === "https:" ||
      url.protocol === "wss:";

    this.wsUrl = new URL(
      `${this.isSecure ? "wss://" : "ws://"}${hostAndPath}/'`,
    );

    const urlWithMode = new URL(opts.mode, this.wsUrl);

    const socket = new WebSocket(
      urlWithMode.toString(),
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

    const url = new URL(
      `${opts.syncerId}/download/${opts.shareAddress}/${opts.doc.format}/${opts.doc.author}${opts.doc.path}`,
      this.wsUrl,
    );

    const readable = websocketReadable(url.toString(), (event) => {
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
    const url = new URL(
      `${opts.syncerId}/upload/${opts.shareAddress}/${opts.doc.format}/${opts.doc.author}${opts.doc.path}`,
      this.wsUrl,
    );

    const writable = websocketWritable(
      url.toString(),
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
