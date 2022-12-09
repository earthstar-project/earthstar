import { ShareAddress } from "../util/doc-types.ts";
import { AttachmentDriverIndexedDB } from "./attachment_drivers/indexeddb.ts";
import { DocDriverIndexedDB } from "./doc_drivers/indexeddb.ts";
import {
  IReplicaAttachmentDriver,
  IReplicaDocDriver,
  IReplicaDriver,
} from "./replica-types.ts";

/** A replica driver which persists data to IndexedDB. */
export class ReplicaDriverWeb implements IReplicaDriver {
  docDriver: IReplicaDocDriver;
  attachmentDriver: IReplicaAttachmentDriver;

  constructor(shareAddress: ShareAddress, namespace?: string) {
    this.docDriver = new DocDriverIndexedDB(shareAddress, namespace);
    this.attachmentDriver = new AttachmentDriverIndexedDB(
      shareAddress,
      namespace,
    );
  }
}
