import { ShareTag } from "../identifiers/share.ts";
import { Store } from "../store/store.ts";

export type PeerOpts = {};

export class Peer {
  constructor(opts: PeerOpts) {
  }

  getStore(share: ShareTag): Store | undefined {
  }

  shares(): Promise<ShareTag[]> {
  }
}
