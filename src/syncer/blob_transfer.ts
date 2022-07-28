import { BlockingBus } from "../streams/stream_utils.ts";
import { DocBase } from "../util/doc-types.ts";
import { isErr, NotFoundError, ValidationError } from "../util/errors.ts";
import {
  BlobTransferOpts,
  BlobTransferProgressEvent,
  BlobTransferStatus,
} from "./syncer_types.ts";

export class BlobTransfer<F> {
  kind: "download" | "upload";
  status: BlobTransferStatus = "ready";

  loaded = 0;
  expectedSize: number;

  private sourceDoc: DocBase<string>;
  private statusBus = new BlockingBus<BlobTransferProgressEvent>();

  hash: string;

  constructor(
    { stream, blobDriver, doc, format }: BlobTransferOpts<F>,
  ) {
    this.sourceDoc = doc;

    const attachmentInfo = format.getAttachmentInfo(doc);

    if (isErr(attachmentInfo)) {
      throw new ValidationError(
        "BlobTransfer was given a doc which has no attachment!",
      );
    }

    this.hash = attachmentInfo.hash;
    this.expectedSize = attachmentInfo.size;

    const updateLoaded = this.updateLoaded.bind(this);

    if (stream instanceof ReadableStream) {
      // Incoming
      // pipe through our bytes counter
      this.kind = "download";

      const counterStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const reader = stream.getReader();

          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              break;
            }

            updateLoaded(value.byteLength);

            controller.enqueue(value);
          }

          controller.close();
        },
      });

      blobDriver.upsert(doc.format, attachmentInfo.hash, counterStream).then(
        () => {
          this.changeStatus("complete");
        },
      );

      this.changeStatus("in_progress");
    } else {
      this.kind = "upload";

      blobDriver.getBlob(doc.format, attachmentInfo.hash).then((blobRes) => {
        if (!blobRes) {
          return new NotFoundError();
        }

        if (isErr(blobRes)) {
          return blobRes;
        }

        const counterTransform = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            updateLoaded(chunk.byteLength);

            controller.enqueue(chunk);
          },
        });

        blobRes.stream.pipeThrough(counterTransform).pipeTo(stream).then(() => {
          this.changeStatus("complete");
        });

        this.changeStatus("in_progress");
      });
    }
  }

  private updateLoaded(toAdd: number) {
    this.loaded += toAdd;
    this.statusBus.send({
      status: this.status,
      bytesLoaded: this.loaded,
      totalBytes: this.expectedSize,
    });
  }

  private changeStatus(status: BlobTransferStatus) {
    this.status = status;

    this.statusBus.send({
      status: status,
      bytesLoaded: this.loaded,
      totalBytes: this.expectedSize,
    });
  }

  get doc(): DocBase<string> {
    return this.sourceDoc;
  }

  onProgress(callback: (event: BlobTransferProgressEvent) => void): () => void {
    const unsub = this.statusBus.on(callback);
    return unsub;
  }

  // TODO: abort
}
