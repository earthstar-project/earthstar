import { ShareAddress } from "../util/doc-types.ts";
import { AttachmentDriverMemory } from "./attachment_drivers/memory.ts";
import { DocDriverMemory } from "./doc_drivers/memory.ts";
import {
  IReplicaAttachmentDriver,
  IReplicaDocDriver,
  IReplicaDriver,
} from "./replica-types.ts";

/** A replica driver which stores data in memory. All data is lost when the replica is closed. */
export class ReplicaDriverMemory implements IReplicaDriver {
  docDriver: IReplicaDocDriver;
  attachmentDriver: IReplicaAttachmentDriver;

  constructor(shareAddress: ShareAddress) {
    this.docDriver = new DocDriverMemory(shareAddress);
    this.attachmentDriver = new AttachmentDriverMemory();
  }
}
