import { join } from "https://deno.land/std@0.154.0/path/mod.ts";
import { ensureDirSync } from "https://deno.land/std@0.154.0/fs/ensure_dir.ts";
import { ShareAddress } from "../util/doc-types.ts";
import { AttachmentDriverFilesystem } from "./attachment_drivers/filesystem.ts";
import { DocDriverSqlite } from "./doc_drivers/sqlite.deno.ts";
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
    ensureDirSync(dirPath);

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
