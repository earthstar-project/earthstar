import { SuperbusMap } from "../../deps.ts";

import { WorkspaceAddress } from "../util/doc-types.ts";
import { IStorageAsync } from "../storage/storage-types.ts";
import { IPeer, PeerId } from "./peer-types.ts";

import { randomId } from "../util/misc.ts";

//--------------------------------------------------

import { Logger } from "../util/log.ts";
let logger = new Logger("peer", "blueBright");
let J = JSON.stringify;

//================================================================================

//export type PeerEvent = 'close';

export class Peer implements IPeer {
  peerId: PeerId;

  //bus: Superbus<PeerEvent>;
  storageMap: SuperbusMap<WorkspaceAddress, IStorageAsync>;
  constructor() {
    logger.debug("constructor");
    //this.bus = new Superbus<PeerEvent>();
    this.storageMap = new SuperbusMap<WorkspaceAddress, IStorageAsync>();
    this.peerId = "peer:" + randomId();
  }

  //--------------------------------------------------
  // getters

  hasWorkspace(workspace: WorkspaceAddress): boolean {
    return this.storageMap.has(workspace);
  }
  workspaces(): WorkspaceAddress[] {
    let keys = [...this.storageMap.keys()];
    keys.sort();
    return keys;
  }
  storages(): IStorageAsync[] {
    let keys = [...this.storageMap.keys()];
    keys.sort();
    return keys.map((key) => this.storageMap.get(key) as IStorageAsync);
  }
  size(): number {
    return this.storageMap.size;
  }
  getStorage(ws: WorkspaceAddress): IStorageAsync | undefined {
    return this.storageMap.get(ws);
  }

  //--------------------------------------------------
  // setters

  async addStorage(storage: IStorageAsync): Promise<void> {
    logger.debug(`addStorage(${J(storage.workspace)})`);
    if (this.storageMap.has(storage.workspace)) {
      logger.debug(`already had a storage with that workspace`);
      throw new Error(
        `Peer.addStorage: already has a storage with workspace ${
          J(storage.workspace)
        }.  Don't add another one.`,
      );
    }
    await this.storageMap.set(storage.workspace, storage);
    logger.debug(`    ...addStorage: done`);
  }
  async removeStorageByWorkspace(workspace: WorkspaceAddress): Promise<void> {
    logger.debug(`removeStorageByWorkspace(${J(workspace)})`);
    await this.storageMap.delete(workspace);
  }
  async removeStorage(storage: IStorageAsync): Promise<void> {
    let existingStorage = this.storageMap.get(storage.workspace);
    if (storage === existingStorage) {
      logger.debug(`removeStorage(${J(storage.workspace)})`);
      await this.removeStorageByWorkspace(storage.workspace);
    } else {
      logger.debug(
        `removeStorage(${
          J(storage.workspace)
        }) -- same workspace but it's a different instance now; ignoring`,
      );
    }
  }
}
