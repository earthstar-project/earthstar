import {
  IBlobTransferReceiveDriver,
  IBlobTransferSendDriver,
} from "../syncer_types.ts";

export class LocalBlobTransferSendDriver implements IBlobTransferSendDriver {
  kind = "send" as const;

  getWritable() {
    const writable = new WritableStream({
      write() {
        return;
      },
    });

    return Promise.resolve(writable);
  }
}

export class LocalBlobTransferReceiveDriver
  implements IBlobTransferReceiveDriver {
  kind = "receive" as const;

  private readable: ReadableStream<Uint8Array>;

  constructor(readable: ReadableStream<Uint8Array>) {
    this.readable = readable;
  }

  getReadable() {
    return Promise.resolve(this.readable);
  }
}
