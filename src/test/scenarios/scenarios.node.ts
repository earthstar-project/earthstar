import { ICryptoDriver } from "../../crypto/crypto-types.ts";
import { DocDriverSqlite } from "../../replica/doc_drivers/sqlite.node.ts";

import {
  AttachmentDriverScenario,
  DocDriverScenario,
  Scenario,
  SyncDriverScenario,
} from "./types.ts";
import {
  universalCryptoDrivers,
  universalPartners,
  universalReplicaAttachmentDrivers,
  universalReplicaDocDrivers,
} from "./scenarios.universal.ts";
import { Syncer } from "../../syncer/syncer.ts";
import { PartnerWebServer } from "../../syncer/partner_web_server.ts";
import { IPeer } from "../../peer/peer-types.ts";
import { CryptoDriverChloride } from "../../crypto/crypto-driver-chloride.ts";
import { sleep } from "../../util/misc.ts";
import { WebSocketServer } from "https://esm.sh/ws@8.8.1";
import { FormatsArg } from "../../formats/format_types.ts";
import { PartnerWebClient } from "../../syncer/partner_web_client.ts";
import { match } from "https://esm.sh/path-to-regexp@6.2.1";
import { AttachmentDriverFilesystem } from "../../replica/attachment_drivers/filesystem.node.ts";
import { deferred } from "../../../deps.ts";
import { SyncAppetite } from "../../syncer/syncer_types.ts";
import getPort from "https://esm.sh/get-port@5.1.1";

export const cryptoScenarios: Scenario<ICryptoDriver>[] = [
  ...universalCryptoDrivers,
  {
    name: "Chloride",
    item: CryptoDriverChloride,
  },
];

export const docDriverScenarios: Scenario<DocDriverScenario>[] = [
  ...universalReplicaDocDrivers,
  {
    name: "Sqlite",
    item: {
      persistent: true,
      builtInConfigKeys: ["schemaVersion", "share"],
      makeDriver: (addr, variant?: string) =>
        new DocDriverSqlite({
          filename: `${addr}.${variant ? `${variant}.` : ""}node.sqlite`,
          mode: "create-or-open",
          share: addr,
        }),
    },
  },
];

export const attachmentDriverScenarios: Scenario<AttachmentDriverScenario>[] = [
  ...universalReplicaAttachmentDrivers,
  {
    name: "Filesystem",
    item: {
      makeDriver: (shareAddr: string, variant?: string) =>
        new AttachmentDriverFilesystem(
          `./src/test/tmp/${shareAddr}${variant ? `/${variant}` : ""}`,
        ),
      persistent: true,
    },
  },
];

export class PartnerScenarioWeb<F> implements SyncDriverScenario<F> {
  private server = deferred<WebSocketServer>();
  private port = deferred<number>();

  formats: FormatsArg<F>;
  appetite: SyncAppetite;

  constructor(formats: FormatsArg<F>, appetite: SyncAppetite) {
    this.formats = formats;

    this.appetite = appetite;

    getPort({ port: 8087 }).then((port) => {
      this.port.resolve(port);
    });
  }

  async setup(peerA: IPeer, peerB: IPeer) {
    const port = await this.port;

    const server = new WebSocketServer({ port });

    this.server.resolve(server);

    const serverSyncerPromise = deferred<Syncer<WebSocket, F>>();

    // Set up server

    server.on("connection", async (socket: WebSocket, req: any) => {
      const transferMatch = match(
        "/:syncerId/:kind/:shareAddress/:formatName/:author/:path*",
        { decode: decodeURIComponent },
      );

      const res = transferMatch(req.url);

      if (res) {
        const syncer = await serverSyncerPromise;

        const { shareAddress, formatName, path, author, kind } = res[
          "params"
        ] as Record<string, any>;

        await syncer.handleTransferRequest({
          shareAddress,
          formatName,
          path: `/${path.join("/")}`,
          author,
          kind: kind as "download" | "upload",
          source: socket,
        });

        return;
      }

      const partner = new PartnerWebClient({
        socket,
        appetite: this.appetite,
      });

      const serverSyncer = peerB.addSyncPartner(partner);

      serverSyncerPromise.resolve(serverSyncer as Syncer<WebSocket, F>);
    });

    const clientPartner = new PartnerWebServer({
      url: `ws://localhost:${port}`,
      appetite: this.appetite,
    });

    const clientSyncer = peerA.addSyncPartner(clientPartner);

    const serverSyncer = await serverSyncerPromise;

    return Promise.resolve([clientSyncer, serverSyncer] as [
      Syncer<undefined, F>,
      Syncer<WebSocket, F>,
    ]);
  }

  async teardown() {
    const server = await this.server;
    server.close();
    return sleep(500);
  }
}

export const syncDriverScenarios: Scenario<
  <F>(formats: FormatsArg<F>, appetite: SyncAppetite) => SyncDriverScenario<F>
>[] = [
  ...universalPartners,
  {
    name: "Web",
    item: (formats, appetite) => new PartnerScenarioWeb(formats, appetite),
  },
];
