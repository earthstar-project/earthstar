import { deferred } from "https://deno.land/std@0.138.0/async/deferred.ts";
import { FormatsArg } from "../../formats/format_types.ts";
import { Peer } from "../../peer/peer.ts";
import { PartnerWebClient } from "../../syncer/partner_web_client.ts";
import { Syncer } from "../../syncer/syncer.ts";
import { randomId } from "../../util/misc.ts";
import { IServerExtension } from "./extension.ts";
import { createServer } from "https://deno.land/std@0.167.0/node/http.ts";
import { WebSocketServer } from "https://esm.sh/ws@8.8.1";

interface ExtensionSyncOpts<F> {
  /** The path to accept HTTP sync requests from, e.g. `/earthstar-api/v2`. Make sure to set this if you're using other extensions which handle requests, as by default this will match any request to /. */
  path?: string;
  formats?: FormatsArg<F>;
  server: ReturnType<typeof createServer>;
}

/** An extension which enables synchronisation over the web via HTTP. */
export class ExtensionSyncWeb<F> implements IServerExtension {
  private path = "";
  private syncers = new Map<string, Syncer<WebSocket, F>>();
  private peer = deferred<Peer>();
  private formats: FormatsArg<F> | undefined;
  private wss: WebSocketServer;
  private server: ReturnType<typeof createServer>;

  constructor(opts: ExtensionSyncOpts<F>) {
    if (opts?.path) {
      this.path = opts.path;
    }

    if (opts?.formats) {
      this.formats = opts.formats;
    }

    this.server = opts.server;
    this.wss = new WebSocketServer({ noServer: true });
  }

  register(peer: Peer) {
    this.peer.resolve(peer);

    const transferPattern = new URLPattern({
      pathname:
        `${this.path}/:syncerId/:kind/:shareAddress/:formatName/:author/:path*`,
    });

    const initiatePattern = new URLPattern({
      pathname: `${this.path}/:mode`,
    });

    this.server.on("upgrade", (req, socket, head) => {
      const reqUrl = `http://0.0.0.0${req.url}`;

      if (transferPattern.test(reqUrl) || initiatePattern.test(reqUrl)) {
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          // @ts-ignore
          this.wss.emit("connection", ws, req);
        });
      }
    });

    this.wss.on("connection", async (socket: WebSocket, req: any) => {
      const reqUrl = `http://0.0.0.0${req.url}`;

      const transferMatch = transferPattern.exec(reqUrl);

      if (transferMatch) {
        const { syncerId, shareAddress, formatName, path, author, kind } =
          transferMatch.pathname.groups;

        const syncer = this.syncers.get(syncerId);

        if (!syncer) {
          return;
        }

        await syncer.handleTransferRequest({
          shareAddress,
          formatName,
          path: `/${path}`,
          author,
          kind: kind as "download" | "upload",
          source: socket,
        });

        return;
      }

      const initiateMatch = initiatePattern.exec(reqUrl);

      if (initiateMatch) {
        const { mode } = initiateMatch.pathname.groups;

        if (mode !== "once" && mode !== "continuous") {
          return;
        }

        const peer = await this.peer;

        const partner = new PartnerWebClient({
          socket,
          appetite: mode === "once" ? "once" : "continuous",
        });

        const description = `Client ${randomId()}`;

        const newSyncer = peer.addSyncPartner(
          partner,
          description,
          this.formats,
        );

        console.log(`${description}: started sync`);

        newSyncer.isDone().then(() => {
          console.log(`${description}: completed sync`);
        }).catch((err) => {
          console.error(`Syncer ${newSyncer.id}: cancelled`, err);
        }).finally(() => {
          console.log(`${description}: removed`);
          this.syncers.delete(newSyncer.id);
        });

        this.syncers.set(newSyncer.id, newSyncer);
      }
    });

    return Promise.resolve();
  }

  async handler(req: Request): Promise<Response | null> {
    return Promise.resolve(null);
  }
}
