import { Peer } from "../../peer/peer.ts";
import { Replica } from "../../replica/replica.ts";
import { IServerExtension } from "./extension.ts";
import * as fs from "https://deno.land/std@0.154.0/node/fs/promises.ts";

interface ExtensionKnownSharesOpts {
  /** The path where the known shares (a JSON array of share addresses) is located. */
  knownSharesPath: string;
  /** A callback used to create the replicas in the known shares list. Mostly useful for choosing how you'd like your shares to be persisted, e.g. probably by Sqlite. */
  onCreateReplica: (shareAddress: string) => Replica;
}

/** An extension for populating a replica server with known shares. Use this to specify which shares you'd like your replica server to sync with others.
 *
 * You most likely want to pass this as the first extension to your replica server.
 */
export class ExtensionKnownShares implements IServerExtension {
  private peer: Peer | null = null;
  private knownSharesPath: string;
  private onCreateReplica: (shareAddress: string) => Replica;

  constructor(opts: ExtensionKnownSharesOpts) {
    this.knownSharesPath = opts.knownSharesPath;
    this.onCreateReplica = opts.onCreateReplica;
  }

  async register(peer: Peer) {
    this.peer = peer;

    const knownSharesRaw = await fs.readFile(this.knownSharesPath, "utf-8");

    const knownShares = JSON.parse(knownSharesRaw) as string[];

    for (const shareAddress of knownShares) {
      const replica = this.onCreateReplica(shareAddress);

      await this.peer.addReplica(replica);
    }
  }

  handler() {
    return Promise.resolve(null);
  }
}
