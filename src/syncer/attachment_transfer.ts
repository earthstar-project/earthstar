import { deferred } from "https://deno.land/std@0.138.0/async/deferred.ts";
import { BlockingBus } from "../streams/stream_utils.ts";
import { DocBase } from "../util/doc-types.ts";
import { isErr, NotFoundError, ValidationError } from "../util/errors.ts";
import {
  AttachmentTransferOpts,
  AttachmentTransferProgressEvent,
  AttachmentTransferStatus,
} from "./syncer_types.ts";

export class AttachmentTransfer<F> {
  kind: "download" | "upload";
  status: AttachmentTransferStatus = "ready";

  loaded = 0;
  expectedSize: number;

  private sourceDoc: DocBase<string>;
  private statusBus = new BlockingBus<AttachmentTransferProgressEvent>();

  isDone = deferred<true>();

  hash: string;

  constructor(
    { stream, replica, doc, format }: AttachmentTransferOpts<F>,
  ) {
    this.sourceDoc = doc;

    const attachmentInfo = format.getAttachmentInfo(doc);

    if (isErr(attachmentInfo)) {
      throw new ValidationError(
        "AttachmentTransfer was given a doc which has no attachment!",
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

      this.changeStatus("in_progress");

      replica.ingestAttachment(format, doc, counterStream).then(
        (result) => {
          if (isErr(result)) {
            console.log(result);
            this.changeStatus("failed");
          }

          this.changeStatus("complete");
        },
      );
    } else {
      this.kind = "upload";

      replica.getAttachment(doc, format).then((attachmentRes) => {
        if (!attachmentRes) {
          return new NotFoundError();
        }

        if (isErr(attachmentRes)) {
          return attachmentRes;
        }

        const counterTransform = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            updateLoaded(chunk.byteLength);

            controller.enqueue(chunk);
          },
        });

        attachmentRes.stream().then((readable) => {
          this.changeStatus("in_progress");
          readable.pipeThrough(counterTransform).pipeTo(stream).then(() => {
            this.changeStatus("complete");
          });
        });
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

  private changeStatus(status: AttachmentTransferStatus) {
    this.status = status;

    this.statusBus.send({
      status: status,
      bytesLoaded: this.loaded,
      totalBytes: this.expectedSize,
    });

    if (status === "complete") {
      this.isDone.resolve();
    }
  }

  get doc(): DocBase<string> {
    return this.sourceDoc;
  }

  onProgress(
    callback: (event: AttachmentTransferProgressEvent) => void,
  ): () => void {
    const unsub = this.statusBus.on(callback);
    return unsub;
  }

  // TODO: abort
}
