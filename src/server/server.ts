import { ServerExtension } from "./extensions/extension.ts";
import { ServerCore } from "./server_core.ts";
import { Peer } from "../peer/peer.ts";

export type ServerOpts = {
  peer: Peer;
  port?: number;
  hostname?: string;
};

/**
 * An extensible Earthstar server able to synchronise with other peers.
 *
 * A server's functionality can be extended using extensions of type `IServerExtension`.
 *
 * ```ts
 * const extensions = [
 *   new ExtensionSyncWebsocket("sync"),
 * ];
 *
 * const server = new Server([
 *   extensions,
 *   {
 *     peer: {
 *       password: "myextremelygoodlongpassword"
 *     }
 *   }
 * ]);
 * ```
 */
export class Server {
  private core: ServerCore;
  private server: Deno.HttpServer<Deno.NetAddr>;

  /**
   * Create a new server with an array of extensions.
   * @param extensions - The extensions used by the server. Extensions will be registered in the order you provide them in, as one extension may depend on the actions of another. For example, the `ExtensionServeContent` may rely on a replica created by `ExtensionKnownShares`.
   */
  constructor(extensions: ServerExtension[], opts: ServerOpts) {
    this.core = new ServerCore(extensions, opts.peer);

    this.server = Deno.serve({
      port: opts?.port,
      hostname: opts?.hostname,
    }, this.core.handler.bind(this.core));
  }

  close() {
    this.server.shutdown();
  }
}
