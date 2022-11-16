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

type SyncerDriverWebClientOpts = {
  /** The URL of the replica server to sync with. */
  url: string;
  appetite: SyncAppetite;
};

/** A syncing partner to be used with replica servers reachable via the internet.
 * Works everywhere.
 */
export class PartnerWebClient<
  IncomingTransferSourceType extends undefined,
> implements ISyncPartner<undefined> {
  syncAppetite: SyncAppetite;
  concurrentTransfers = 16;
  payloadThreshold = 8;
  rangeDivision = 8;

  private isSecure: boolean;
  private wsUrl: string;

  private socket: WebSocket;
  private incomingQueue = new AsyncQueue<SyncerEvent>();
  private socketIsReady = deferred();

  constructor(opts: SyncerDriverWebClientOpts) {
    this.syncAppetite = opts.appetite;

    // Check if it's a URL of some kind.
    const url = new URL(opts.url);

    // Check if it's a web syncer
    const hostAndPath = `${url.host}${
      url.pathname === "/" ? "" : url.pathname
    }`;

    this.isSecure = url.protocol === "https:" ||
      url.protocol === "wss:";

    this.wsUrl = `${this.isSecure ? "wss://" : "ws://"}${hostAndPath}/'`;

    const urlWithMode = new URL(opts.appetite, this.wsUrl);

    this.socket = new WebSocket(
      urlWithMode.toString(),
    );

    this.socket.onopen = () => {
      this.socketIsReady.resolve();
    };

    this.socket.binaryType = "arraybuffer";

    this.socket.onmessage = (event) => {
      this.incomingQueue.push(JSON.parse(event.data));
    };

    this.socket.onclose = () => {
      this.incomingQueue.close();
    };

    this.socket.onerror = () => {
      this.incomingQueue.close({
        withError: new EarthstarError("Websocket error."),
      });
    };
  }

  async sendEvent(event: SyncerEvent): Promise<void> {
    await this.socketIsReady;

    if (
      this.socket.readyState === this.socket.CLOSED ||
      this.socket.readyState === this.socket.CLOSING
    ) {
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
    opts: GetTransferOpts,
  ): Promise<ReadableStream<Uint8Array> | undefined> {
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
  ): Promise<WritableStream<Uint8Array> | NotSupportedError> {
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
    | undefined
    | NotSupportedError
  > {
    // We don't expect any external requests.
    return Promise.resolve(
      new NotSupportedError(
        "SyncDriverWebClient does not support external transfer requests.",
      ),
    );
  }
}
