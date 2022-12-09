import { serve } from "https://deno.land/std@0.167.0/http/server.ts";
import { IServerExtension } from "./extensions/extension.ts";
import { ServerCore } from "./server_core.ts";

export type ServerOpts = {
  port?: number;
  hostname?: string;
};

/**
 * An extensible replica server able to synchronise with other peers.
 *
 * A replica server's functionality can be extended using extensions of type `IReplicaServerExtension`.
 */
export class Server {
  private core: ServerCore;
  private abortController: AbortController;
  private server: Promise<void>;

  /**
   * Create a new replica server with an array of extensions.
   * @param extensions - The extensions used by the replica server. Extensions will be registered in the order you provide them in, as one extension may depend on the actions of another. For example, the `ExtensionServeContent` may rely on a replica created by `ExtensionKnownShares`.
   */
  constructor(extensions: IServerExtension[], opts?: ServerOpts) {
    this.core = new ServerCore(extensions);

    this.abortController = new AbortController();

    this.server = serve(this.core.handler.bind(this.core), {
      port: opts?.port,
      hostname: opts?.hostname,
      signal: this.abortController.signal,
    });
  }

  async close() {
    this.abortController.abort();

    await this.server;
  }
}
