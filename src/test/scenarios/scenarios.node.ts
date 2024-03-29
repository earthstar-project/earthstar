import { ICryptoDriver } from "../../crypto/crypto-types.ts";
import { DocDriverSqlite } from "../../replica/doc_drivers/sqlite.node.ts";

import {
  AttachmentDriverScenario,
  DocDriverScenario,
  Scenario,
  ServerScenario,
  SyncPartnerScenario,
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

import { WebSocketServer } from "https://esm.sh/ws@8.8.1";
import { FormatsArg } from "../../formats/format_types.ts";
import { PartnerWebClient } from "../../syncer/partner_web_client.ts";
import { match } from "https://esm.sh/path-to-regexp@6.2.1";
import { AttachmentDriverFilesystem } from "../../replica/attachment_drivers/filesystem.node.ts";
import { deferred } from "../../../deps.ts";
import { SyncAppetite } from "../../syncer/syncer_types.ts";
import getPort from "https://esm.sh/get-port@5.1.1";
import { setGlobalCryptoDriver } from "../../crypto/global-crypto-driver.ts";
import { Server } from "../../server/server.node.ts";
import { IServerExtension } from "../../server/extensions/extension.ts";
import { ExtensionSyncWeb } from "../../server/extensions/sync_web.node.ts";
import { createServer } from "https://deno.land/std@0.167.0/node/http.ts";
import { LANSession } from "../../discovery/discovery_lan.ts";
import { TcpProvider } from "../../tcp/tcp_provider.ts";

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

export class PartnerScenarioWeb<F> implements SyncPartnerScenario<F> {
  private server = deferred<WebSocketServer>();
  private port = deferred<number>();

  formats: FormatsArg<F>;
  appetite: SyncAppetite;
  syncContinuousWait = 1800;

  constructor(formats: FormatsArg<F>, appetite: SyncAppetite) {
    setGlobalCryptoDriver(CryptoDriverChloride);

    this.formats = formats;

    this.appetite = appetite;

    getPort({ port: 8087 }).then((port) => {
      this.port.resolve(port);

      const server = new WebSocketServer({ port });

      this.server.resolve(server);
    });
  }

  async setup(peerA: IPeer, peerB: IPeer) {
    const port = await this.port;

    const server = await this.server;

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

      const serverSyncer = peerB.addSyncPartner(partner, "Test web client");

      serverSyncerPromise.resolve(serverSyncer as Syncer<WebSocket, F>);
    });

    const serverPartner = new PartnerWebServer({
      url: `ws://localhost:${port}`,
      appetite: this.appetite,
    });

    const clientSyncer = peerA.addSyncPartner(serverPartner, "Test web server");

    const serverSyncer = await serverSyncerPromise;

    return Promise.resolve([clientSyncer, serverSyncer] as [
      Syncer<undefined, F>,
      Syncer<WebSocket, F>,
    ]);
  }

  async teardown() {
    const server = await this.server;
    server.close();
  }
}

export class PartnerScenarioTCP<F> implements SyncPartnerScenario<F> {
  private abortController: AbortController;
  formats: FormatsArg<F>;
  appetite: SyncAppetite;
  syncContinuousWait = 1800;

  constructor(formats: FormatsArg<F>, appetite: SyncAppetite) {
    this.formats = formats;
    this.appetite = appetite;
    this.abortController = new AbortController();
  }

  async setup(peerA: IPeer, peerB: IPeer) {
    const lanSessionPromiseA = deferred<LANSession>();
    const lanSessionPromiseB = deferred<LANSession>();

    // Set up listeners...
    const portA = await getPort({ port: 17171 });
    const portB = await getPort({ port: 17172 });

    const tcpProvider = new TcpProvider();

    const listenerA = tcpProvider.listen({ port: portA });
    const listenerB = tcpProvider.listen({ port: portB });

    this.abortController.signal.onabort = () => {
      listenerA.close();
      listenerB.close();
    };

    (async () => {
      for await (const conn of listenerA) {
        const session = await lanSessionPromiseA;

        await session.addConn(conn);
      }
    })();

    (async () => {
      for await (const conn of listenerB) {
        const session = await lanSessionPromiseB;

        await session.addConn(conn);
      }
    })();

    lanSessionPromiseA.resolve(
      new LANSession(
        {
          target: {
            hostname: "127.0.0.1",
            name: "Peer B",
          },
          onComplete: () => {},
          ourPort: portA,
        },
      ),
    );

    lanSessionPromiseB.resolve(
      new LANSession({
        initiator: {
          appetite: this.appetite,
          port: portA,
        },
        target: {
          hostname: "127.0.0.1",
          name: "Peer A",
        },
        ourPort: portB,
        onComplete: () => {},
      }),
    );

    const lanSessionA = await lanSessionPromiseA;
    const lanSessionB = await lanSessionPromiseB;

    const syncerA = peerA.addSyncPartner(
      await lanSessionA.partner,
      "Peer B",
    );
    const syncerB = peerB.addSyncPartner(
      await lanSessionB.partner,
      "Peer A",
    );

    lanSessionA.syncer.resolve(syncerA);
    lanSessionB.syncer.resolve(syncerB);

    return [syncerA, syncerB] as [
      Syncer<unknown, F>,
      Syncer<unknown, F>,
    ];
  }

  teardown() {
    this.abortController.abort();

    return Promise.resolve();
  }
}

export const syncDriverScenarios: Scenario<
  <F>(formats: FormatsArg<F>, appetite: SyncAppetite) => SyncPartnerScenario<F>
>[] = [
  ...universalPartners,
  {
    name: "Web",
    item: (formats, appetite) => new PartnerScenarioWeb(formats, appetite),
  },

  {
    name: "TCP",
    item: (formats, appetite) => new PartnerScenarioTCP(formats, appetite),
  },
];

export class WebServerScenario implements ServerScenario {
  private port: number;
  private server = deferred<Server>();

  constructor(port: number) {
    this.port = port;
  }

  start(testExtension: IServerExtension) {
    const nodeServer = createServer();

    const server: Server = new Server([
      testExtension,
      new ExtensionSyncWeb({ server: nodeServer }),
    ], { port: this.port, server: nodeServer });

    this.server.resolve(server);

    return Promise.resolve();
  }

  async close() {
    const server = await this.server;

    return server.close();
  }
}
