import { createServer } from "node:http";
import { ServerExtension } from "./extensions/extension.ts";
import { Buffer } from "https://deno.land/std@0.167.0/node/buffer.ts";
import { ServerCore } from "./server_core.ts";
import { Peer } from "../peer/peer.ts";

export type ServerOpts = {
  peer: Peer;
  port?: number;
  server: ReturnType<typeof createServer>;
};

/**
 * An extensible server able to synchronise with other peers.
 *
 * A server's functionality can be extended using extensions of type `IServerExtension`.
 */
export class Server {
  private core: ServerCore;
  private server: ReturnType<typeof createServer>;

  /**
   * Create a new server with an array of extensions.
   * @param extensions - The extensions used by the server. Extensions will be registered in the order you provide them in, as one extension may depend on the actions of another. For example, the `ExtensionServeContent` may rely on a replica created by `ExtensionKnownShares`.
   */
  constructor(extensions: ServerExtension[], opts: ServerOpts) {
    this.core = new ServerCore(extensions, opts.peer);

    this.server = opts.server;

    this.server.on("request", async (req: any, res: any) => {
      let data = undefined;

      if (req.method === "POST") {
        const buffers = [];

        for await (const chunk of req) {
          buffers.push(chunk);
        }

        data = Buffer.concat(buffers).toString();
      }

      const headers = new Headers();

      for (const key in req.headers) {
        if (req.headers[key]) headers.append(key, req.headers[key] as string);
      }

      // Need the hostname here so the URL plays nice with Node's URL class.
      const url = `http://0.0.0.0${req.url}`;

      const request = new Request(url, {
        method: req.method,
        headers,
        body: data,
      });

      const response = await this.core.handler(request);

      // Headers
      for (const [key, value] of response.headers) {
        res.setHeader(key, value);
      }

      // Status
      res.statusCode = response.status;

      // Body
      // TODO: Handle streaming responses.
      if (response.body) {
        res.end(response.body);
      }

      res.end();
    });

    this.server.listen(opts?.port);
  }

  close() {
    this.server.close();
  }
}
