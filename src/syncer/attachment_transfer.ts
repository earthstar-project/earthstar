import { deferred } from "../../deps.ts";
import { BlockingBus } from "../streams/stream_utils.ts";
import { DocBase, ShareAddress } from "../util/doc-types.ts";
import { isErr, ValidationError } from "../util/errors.ts";
import { BumpingTimeout } from "./bumping_timeout.ts";
import { TIMEOUT_MS } from "./constants.ts";
import { MultiDeferred } from "./multi_deferred.ts";
import {
  AttachmentTransferOpts,
  AttachmentTransferProgressEvent,
  AttachmentTransferStatus,
} from "./syncer_types.ts";

export class AttachmentTransfer<F> {
  kind: "download" | "upload";
  status: AttachmentTransferStatus = "ready";
  share: ShareAddress;

  loaded = 0;
  expectedSize: number;

  private sourceDoc: DocBase<string>;
  private statusBus = new BlockingBus<AttachmentTransferProgressEvent>();
  private transferOp = deferred<() => Promise<void>>();
  private abortCb: () => void;

  private multiDeferred = new MultiDeferred();

  hash: string;

  requester: "us" | "them";

  constructor(
    { stream, replica, doc, format, requester, counterpartId }:
      AttachmentTransferOpts<F>,
  ) {
    this.sourceDoc = doc;
    this.share = replica.share;
    this.requester = requester;

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

      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

      this.abortCb = () => {
        if (reader) {
          reader.cancel();
        } else {
          stream.cancel();
        }
      };

      const getLoaded = () => {
        return this.loaded;
      };

      const makeCounterStream = () =>
        new ReadableStream<Uint8Array>({
          async start(controller) {
            const newReader = stream.getReader();

            // @ts-ignore Node's ReadableStream types does not like this for some reason.
            reader = newReader;

            const bumpingTimeout = new BumpingTimeout(() => {
              controller.error("Attachment download timed out.");
            }, TIMEOUT_MS);

            while (true) {
              const { done, value } = await newReader.read();

              // Clear timeout here.
              bumpingTimeout.bump();

              if (done) {
                break;
              }

              updateLoaded(value.byteLength);

              controller.enqueue(value);

              if (getLoaded() >= attachmentInfo.size) {
                break;
              }
            }

            bumpingTimeout.close();
            controller.close();
          },
        });

      this.transferOp.resolve(() => {
        const promise = deferred<void>();

        replica.ingestAttachment(
          format,
          doc,
          makeCounterStream(),
          counterpartId,
        )
          .then(
            (result) => {
              if (isErr(result) && this.loaded === 0) {
                // The other peer didn't have this attachment.
                this.changeStatus("missing_attachment");
                return;
              }

              if (isErr(result)) {
                console.warn(
                  `Couldn't ingest the attachment for ${doc.path} by ${doc.author}: ${result.message}`,
                );

                promise.reject(result);
                return;
              }

              promise.resolve();
            },
          ).catch((err) => {
            console.log(err);
            promise.reject(err);
          });

        return promise;
      });
    } else {
      this.kind = "upload";

      this.abortCb = () => {
        stream.abort().catch(() => {
          // Node doesn't let you abort a locked writablestream (wrong)
          // https://github.com/nodejs/node/issues/41159
        });
      };

      replica.getAttachment(doc, format).then(async (attachmentRes) => {
        if (!attachmentRes) {
          await this.changeStatus("missing_attachment");
          await stream.abort();
          return;
        }

        if (isErr(attachmentRes)) {
          await this.changeStatus("failed");
          await stream.abort();
          return;
        }

        const counterTransform = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            updateLoaded(chunk.byteLength);

            controller.enqueue(chunk);
          },
        });

        this.transferOp.resolve(() =>
          attachmentRes.stream().then((readable) => {
            return readable.pipeThrough(counterTransform).pipeTo(stream);
          }).catch((err) => {
            console.log(err);
          })
        );
      });
    }
  }

  async start() {
    if (this.status !== "ready") {
      // maybe throw here.
      return;
    }

    const transferOp = await this.transferOp;

    await this.changeStatus("in_progress");

    transferOp().then(async () => {
      await this.changeStatus("complete");
    }).catch(async () => {
      await this.changeStatus("failed");
    });

    return;
  }

  private updateLoaded(toAdd: number) {
    this.loaded += toAdd;
    this.statusBus.send({
      status: this.status,
      bytesLoaded: this.loaded,
      totalBytes: this.expectedSize,
    });
  }

  private async changeStatus(status: AttachmentTransferStatus) {
    if (
      this.status === "complete" || this.status === "failed" ||
      this.status === "missing_attachment"
    ) {
      return;
    }

    this.status = status;

    await this.statusBus.send({
      status: status,
      bytesLoaded: this.loaded,
      totalBytes: this.expectedSize,
    });

    if (status === "complete") {
      this.multiDeferred.resolve();
    }

    if (status === "failed") {
      this.multiDeferred.reject("Attachment transfer failed");
    }

    if (status === "missing_attachment") {
      this.multiDeferred.reject("The other peer does not have this attachment");
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

  abort() {
    this.abortCb();
  }

  isDone() {
    return this.multiDeferred.getPromise();
  }
}
