import { createServer } from "https://deno.land/std@0.167.0/node/http.ts";
import { IServerExtension } from "./extensions/extension.ts";
import { Buffer } from "https://deno.land/std@0.167.0/node/buffer.ts";
import { ServerCore } from "./server_core.ts";

export type ServerOpts = {
  port?: number;
  server: ReturnType<typeof createServer>;
};

/**
 * An extensible replica server able to synchronise with other peers.
 *
 * A replica server's functionality can be extended using extensions of type `IReplicaServerExtension`.
 */
export class Server {
  private core: ServerCore;
  private server: ReturnType<typeof createServer>;

  /**
   * Create a new replica server with an array of extensions.
   * @param extensions - The extensions used by the replica server. Extensions will be registered in the order you provide them in, as one extension may depend on the actions of another. For example, the `ExtensionServeContent` may rely on a replica created by `ExtensionKnownShares`.
   */
  constructor(extensions: IServerExtension[], opts: ServerOpts) {
    this.core = new ServerCore(extensions);

    this.server = opts.server;

    this.server.on("request", async (req, res) => {
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
