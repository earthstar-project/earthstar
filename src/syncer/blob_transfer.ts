import { Replica } from "../replica/replica.ts";
import { DocBase, DocInputBase, FormatName, Path } from "../util/doc-types.ts";
import { isErr, NotFoundError } from "../util/errors.ts";
import {
  BlobTransferOpts,
  BlobTransferStatus,
  IBlobTransferDriver,
} from "./syncer_types.ts";
import { IFormat } from "../formats/format_types.ts";
import { FallbackDoc, FormatArg } from "../formats/default.ts";

export class BlobTransfer<
  N extends FormatName,
  I extends DocInputBase<N>,
  DocType extends DocBase<N>,
  FormatType extends IFormat<N, I, DocType>,
> {
  private driver: IBlobTransferDriver;
  private status: BlobTransferStatus = "ready";
  private replica: Replica;
  private doc: DocType;
  private format: FormatType;

  constructor(opts: BlobTransferOpts<N, I, DocType, FormatType>) {
    this.driver = opts.driver;
    this.replica = opts.replica;
    this.doc = opts.doc;
    this.format = opts.format;
  }

  async start() {
    if (this.status !== "ready") {
      // throw.
    }

    if (this.driver.kind === "send") {
      // TODO: One day we will have the tools to make the doc / format types make sense.
      // Until then, we must resort to ferreting away `any` deep underground
      const blobRes = await this.replica.getBlob(
        this.doc as any,
        this.format as FormatArg<FormatType>,
      );

      if (!blobRes) {
        return new NotFoundError();
      }

      if (isErr(blobRes)) {
        return blobRes;
      }

      const writable = await this.driver.getWritable();

      // TODO: Pipethrough a byte counter.

      blobRes.stream.pipeTo(writable);
    }

    if (this.driver.kind === "receive") {
      // get the stream from the transfer driver
      const readable = await this.driver.getReadable();

      // pipe through our bytes counter
      this.replica.ingestBlob(this.format, this.doc, readable);
    }
  }

  // onProgress
  // getStatus
  // abort
}
