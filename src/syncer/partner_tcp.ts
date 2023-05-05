import { AsyncQueue, concat } from "../../deps.ts";
import { NotSupportedError } from "../util/errors.ts";
import { DecryptLengthDelimitStream, DecryptStream } from "./message_crypto.ts";
import {
  GetTransferOpts,
  ISyncPartner,
  SyncAppetite,
  SyncerEvent,
} from "./syncer_types.ts";

export class PartnerTcp<
  FormatsType,
  IncomingTransferSourceType extends Deno.Conn,
> implements ISyncPartner<IncomingTransferSourceType> {
  concurrentTransfers = 1024;
  payloadThreshold = 1;
  rangeDivision = 2;
  syncAppetite: SyncAppetite;
  private messageConn: Deno.Conn;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();
  private incomingQueue = new AsyncQueue<SyncerEvent>();
  private derivedKey: CryptoKey;
  private port: number;

  constructor(
    conn: Deno.Conn,
    appetite: SyncAppetite,
    encryptionKey: CryptoKey,
    port: number,
  ) {
    this.syncAppetite = appetite;
    this.messageConn = conn;
    this.derivedKey = encryptionKey;
    this.port = port;

    const decoder = this.decoder;
    const incomingQueue = this.incomingQueue;

    this.messageConn.readable
      .pipeThrough(new DecryptLengthDelimitStream(encryptionKey))
      .pipeThrough(new DecryptStream(encryptionKey))
      .pipeTo(
        new WritableStream({
          write(chunk) {
            const decoded = decoder.decode(chunk);
            const parsed = JSON.parse(decoded);

            incomingQueue.push(parsed);
          },
          abort() {
            incomingQueue.close();
          },
          close() {
            incomingQueue.close();
          },
        }),
      ).catch(() => {
        // The other side may close this connection.
      });
  }

  async sendEvent(event: SyncerEvent): Promise<void> {
    const encoded = this.encoder.encode(JSON.stringify(event));
    const encrypted = await this.encryptBytes(encoded);

    try {
      await this.messageConn.write(encrypted);
    } catch {
      // The connection may have been closed.
    }
  }

  private async encryptBytes(bytes: Uint8Array): Promise<Uint8Array> {
    const lenIv = crypto.getRandomValues(new Uint8Array(12));
    const bytesIv = crypto.getRandomValues(new Uint8Array(12));

    const encryptedBytes = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: bytesIv,
      },
      this.derivedKey,
      bytes,
    );

    const lengthBytes = new Uint8Array(4);
    const lenView = new DataView(lengthBytes.buffer);
    lenView.setUint32(0, bytesIv.byteLength + encryptedBytes.byteLength);

    const encryptedLength = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: lenIv,
      },
      this.derivedKey,
      lengthBytes,
    );

    const encryptedMessage = concat(
      lenIv,
      new Uint8Array(encryptedLength),
      bytesIv,
      new Uint8Array(encryptedBytes),
    );

    return encryptedMessage;
  }

  getEvents(): AsyncIterable<SyncerEvent> {
    return this.incomingQueue;
  }

  closeConnection(): Promise<void> {
    try {
      this.messageConn.close();
    } catch {
      // It was closed already (by the other side)
    }

    return Promise.resolve();
  }

  async getDownload(
    opts: GetTransferOpts,
  ): Promise<ReadableStream<Uint8Array> | NotSupportedError | undefined> {
    const encoder = new TextEncoder();

    const shareAddressBytes = encoder.encode(opts.shareAddress);
    const authorBytes = encoder.encode(opts.doc.author);
    const formatBytes = encoder.encode(opts.doc.format);
    const pathBytes = encoder.encode(opts.doc.path);

    // download ID!
    // authorBytes (59)
    // share len (2)
    // share address (share len)
    // format len (1)
    // format (format len)
    // path len (2)
    // path (path len)

    const transferDescBytes = new Uint8Array(
      59 +
        1 + shareAddressBytes.byteLength +
        1 + formatBytes.byteLength +
        pathBytes.byteLength,
    );

    let position = 0;

    const transferView = new DataView(transferDescBytes.buffer);

    transferDescBytes.set(authorBytes, position);

    position += authorBytes.byteLength;

    transferView.setUint8(position, shareAddressBytes.byteLength);

    position += 1;

    transferDescBytes.set(shareAddressBytes, position);

    position += shareAddressBytes.byteLength;

    transferView.setUint8(position, formatBytes.byteLength);

    position += 1;

    transferDescBytes.set(formatBytes, position);

    position += formatBytes.byteLength;

    transferDescBytes.set(pathBytes, position);

    const newConn = await Deno.connect({
      port: this.port,
      hostname: (this.messageConn.remoteAddr as Deno.NetAddr).hostname,
    });

    // Send the byte identifying this connection as an attachment transfer
    const idByte = new Uint8Array(1);
    const idView = new DataView(idByte.buffer);
    // 1 is the ID for an attachment transfer
    idView.setUint8(0, 1);

    await newConn.write(idByte);

    await newConn.write(await this.encryptBytes(transferDescBytes));

    const derivedKey = this.derivedKey;

    const readable = new ReadableStream({
      async start(controller) {
        await newConn.readable
          .pipeThrough(new DecryptLengthDelimitStream(derivedKey))
          .pipeThrough(new DecryptStream(derivedKey))
          .pipeTo(
            new WritableStream({
              write(chunk) {
                controller.enqueue(chunk);
              },
            }),
          );

        try {
          newConn.close();
        } catch {
          // Closed by other side
        }
      },
    });

    return readable;
  }

  handleUploadRequest(
    _opts: GetTransferOpts,
  ): Promise<NotSupportedError | WritableStream<Uint8Array>> {
    return Promise.resolve(new NotSupportedError());
  }

  handleTransferRequest(
    source: Deno.Conn,
    kind: "upload" | "download",
  ): Promise<
    | NotSupportedError
    | WritableStream<Uint8Array>
    | ReadableStream<Uint8Array>
    | undefined
  > {
    if (kind === "upload") {
      return Promise.resolve(new NotSupportedError());
    }

    const encryptBytes = this.encryptBytes.bind(this);

    const connWriter = source.writable.getWriter();

    // a writable stream which writes encrypted values to the conn.
    const writable = new WritableStream<Uint8Array>({
      async write(chunk) {
        const encrypted = await encryptBytes(chunk);

        await connWriter.ready;

        await connWriter.write(encrypted);
      },
      abort() {
        try {
          source.close();
        } catch {
          // Other side closed it
        }
      },
      close() {
        try {
          source.close();
        } catch {
          // Other side closed it
        }
      },
    });

    return Promise.resolve(writable);
  }
}
