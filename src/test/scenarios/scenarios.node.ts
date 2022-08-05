import { ICryptoDriver } from "../../crypto/crypto-types.ts";
import { DocDriverSqlite } from "../../replica/doc_drivers/sqlite.node.ts";

import {
  AttachmentDriverScenario,
  DocDriverScenario,
  PartnerScenario,
  Scenario,
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
import { deferred } from "https://deno.land/std@0.138.0/async/deferred.ts";
//import { WebSocketServer } from "https://esm.sh/ws";
import { CryptoDriverChloride } from "../../crypto/crypto-driver-chloride.ts";
import { sleep } from "../../util/misc.ts";
import { WebSocketServer } from "ws";
import { FormatsArg } from "../../formats/format_types.ts";
import { PartnerWebClient } from "../../syncer/partner_web_client.ts";
import { match } from "https://esm.sh/path-to-regexp@6.2.1";

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
];

export class PartnerScenarioWeb<F> implements PartnerScenario<F> {
  _server: WebSocketServer;

  formats: FormatsArg<F>;

  constructor(formats: FormatsArg<F>) {
    this.formats = formats;
    this._server = new WebSocketServer({ port: 8083 });
  }

  async setup(peerA: IPeer, peerB: IPeer) {
    const serverSyncerPromise = deferred<Syncer<WebSocket, F>>();

    // Set up server

    this._server.on("connection", async (socket: WebSocket, req: any) => {
      const partner = new PartnerWebServer({
        socket,
      });

      const transferMatch = match(
        "/:syncerId/:kind/:shareAddress/:formatName/:author/:path*",
        { decode: decodeURIComponent },
      );

      const res = transferMatch(req.url);

      if (res) {
        const syncer = await serverSyncerPromise;

        const { shareAddress, formatName, path, author, kind } =
          res["params"] as Record<string, any>;

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

      serverSyncerPromise.resolve(
        new Syncer({
          partner,
          mode: "once",
          peer: peerB,
          formats: this.formats,
        }),
      );
    });

    const clientSyncer = new Syncer({
      partner: new PartnerWebClient({
        url: "ws://localhost:8083",
      }),
      mode: "once",
      peer: peerA,
      formats: this.formats,
    });

    const serverSyncer = await serverSyncerPromise;

    return Promise.resolve(
      [clientSyncer, serverSyncer] as [
        Syncer<undefined, F>,
        Syncer<WebSocket, F>,
      ],
    );
  }

  teardown() {
    this._server.close();
    return sleep(500);
  }
}

export const partnerScenarios: Scenario<
  <F>(
    formats: FormatsArg<F>,
  ) => PartnerScenario<F>
>[] = [...universalPartners, {
  name: "Web",
  item: (formats) => new PartnerScenarioWeb(formats),
}];
