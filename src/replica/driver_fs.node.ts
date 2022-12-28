import { join } from "https://deno.land/std@0.154.0/node/path.ts";
import {
  existsSync,
  mkdirSync,
} from "https://deno.land/std@0.154.0/node/fs.ts";
import { ShareAddress } from "../util/doc-types.ts";
import { AttachmentDriverFilesystem } from "./attachment_drivers/filesystem.node.ts";
import { DocDriverSqlite } from "./doc_drivers/sqlite.node.ts";
import {
  IReplicaAttachmentDriver,
  IReplicaDocDriver,
  IReplicaDriver,
} from "./replica-types.ts";

/** A replica driver which persists data to the filesystem. */
export class ReplicaDriverFs implements IReplicaDriver {
  docDriver: IReplicaDocDriver;
  attachmentDriver: IReplicaAttachmentDriver;

  constructor(shareAddress: ShareAddress, dirPath: string) {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath);
    }

    this.docDriver = new DocDriverSqlite({
      filename: join(dirPath, `${shareAddress}.sql`),
      mode: "create-or-open",
      share: shareAddress,
    });
    this.attachmentDriver = new AttachmentDriverFilesystem(
      join(dirPath, "attachments"),
    );
  }
}
