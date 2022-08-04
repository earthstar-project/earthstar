import { ShareAddress } from "../util/doc-types.ts";
import { AttachmentDriverMemory } from "./attachment_drivers/memory.ts";
import { DocDriverMemory } from "./doc_drivers/memory.ts";
import {
  IReplicaAttachmentDriver,
  IReplicaDocDriver,
  IReplicaDriver,
} from "./replica-types.ts";

export class ReplicaDriverMemory implements IReplicaDriver {
  docDriver: IReplicaDocDriver;
  attachmentDriver: IReplicaAttachmentDriver;

  constructor(shareAddress: ShareAddress) {
    this.docDriver = new DocDriverMemory(shareAddress);
    this.attachmentDriver = new AttachmentDriverMemory();
  }
}
