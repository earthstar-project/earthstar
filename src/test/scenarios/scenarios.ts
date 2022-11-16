import { CryptoDriverSodium } from "../../crypto/crypto-driver-sodium.ts";
import { ICryptoDriver } from "../../crypto/crypto-types.ts";
import { DocDriverLocalStorage } from "../../replica/doc_drivers/localstorage.ts";
import { DocDriverSqliteFfi } from "../../replica/doc_drivers/sqlite_ffi.ts";
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
import { IPeer } from "../../peer/peer-types.ts";
import { serve } from "https://deno.land/std@0.129.0/http/server.ts";
import { DocDriverSqlite } from "../../replica/doc_drivers/sqlite.deno.ts";
import { AttachmentDriverFilesystem } from "../../replica/attachment_drivers/filesystem.ts";
import { PartnerWebServer } from "../../syncer/partner_web_server.ts";
import { PartnerWebClient } from "../../syncer/partner_web_client.ts";
import { FormatsArg } from "../../formats/format_types.ts";

import "https://deno.land/x/indexeddb@1.3.5/polyfill_memory.ts";
import { AttachmentDriverIndexedDB } from "../../replica/attachment_drivers/indexeddb.ts";
import { DocDriverIndexedDB } from "../../replica/doc_drivers/indexeddb.ts";
import { deferred } from "../../../deps.ts";
import { SyncAppetite } from "../../syncer/syncer_types.ts";
import { randomId } from "../../util/misc.ts";
import { getFreePort } from "https://deno.land/x/free_port@v1.2.0/mod.ts";

export const cryptoScenarios: Scenario<ICryptoDriver>[] = [
  ...universalCryptoDrivers,
  {
    name: "Sodium",
    item: CryptoDriverSodium,
  },
];

export const docDriverScenarios: Scenario<DocDriverScenario>[] = [
  ...universalReplicaDocDrivers,
  {
    name: "LocalStorage",
    item: {
      persistent: true,
      builtInConfigKeys: [],
      makeDriver: (addr, variant?: string) =>
        new DocDriverLocalStorage(addr, variant),
    },
  },
  {
    name: "Sqlite FFI",
    item: {
      persistent: true,
      builtInConfigKeys: ["schemaVersion", "share"],
      makeDriver: (addr, variant?: string) =>
        new DocDriverSqliteFfi({
          filename: `${addr}.${variant ? `${variant}.` : ""}ffi.sqlite`,
          mode: "create-or-open",
          share: addr,
        }),
    },
  },
  {
    name: "Sqlite",
    item: {
      persistent: true,
      builtInConfigKeys: ["schemaVersion", "share"],
      makeDriver: (addr, variant?: string) =>
        new DocDriverSqlite({
          filename: `${addr}.${variant ? `${variant}.` : ""}sqlite`,
          mode: "create-or-open",
          share: addr,
        }),
    },
  },
  {
    name: "IndexedDB",
    item: {
      persistent: true,
      builtInConfigKeys: [],
      makeDriver: (addr, variant?: string) =>
        new DocDriverIndexedDB(addr, variant),
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
  {
    name: "IndexedDB",
    item: {
      makeDriver: (shareAddr: string, variant?: string) =>
        new AttachmentDriverIndexedDB(shareAddr, variant),
      persistent: true,
    },
  },
];

export class PartnerScenarioWeb<F> implements SyncDriverScenario<F> {
  private serve: Promise<void> | undefined;
  private abortController: AbortController;

  formats: FormatsArg<F>;
  appetite: SyncAppetite;

  constructor(formats: FormatsArg<F>, appetite: SyncAppetite) {
    this.formats = formats;
    this.appetite = appetite;
    this.abortController = new AbortController();
  }

  async setup(peerA: IPeer, peerB: IPeer) {
    const serverSyncerPromise = deferred<Syncer<WebSocket, F>>();

    const handler = async (req: Request) => {
      const transferPattern = new URLPattern({
        pathname: "/:syncerId/:kind/:shareAddress/:formatName/:author/:path*",
      });

      const transferMatch = transferPattern.exec(req.url);

      if (transferMatch) {
        const { socket, response } = Deno.upgradeWebSocket(req);

        const syncer = await serverSyncerPromise;

        const { shareAddress, formatName, path, author, kind } =
          transferMatch.pathname.groups;

        syncer.handleTransferRequest({
          shareAddress,
          formatName,
          path: `/${path}`,
          author,
          kind: kind as "download" | "upload",
          source: socket,
        });

        return response;
      }

      const { socket, response } = Deno.upgradeWebSocket(req);

      const partner = new PartnerWebServer({ socket, appetite: this.appetite });

      const serverSyncer = peerB.addSyncPartner(partner);

      serverSyncerPromise.resolve(serverSyncer as Syncer<WebSocket, F>);

      return response;
    };

    this.abortController = new AbortController();

    const port = await getFreePort(8087);

    this.serve = serve(handler, {
      hostname: "0.0.0.0",
      port: port,
      signal: this.abortController.signal,
    });

    const clientPartner = new PartnerWebClient({
      url: `ws://localhost:${port}`,
      appetite: this.appetite,
    });

    const serverSyncer = await serverSyncerPromise;

    const clientSyncer = peerA.addSyncPartner(clientPartner);

    return Promise.resolve(
      [clientSyncer, serverSyncer] as [
        Syncer<unknown, F>,
        Syncer<unknown, F>,
      ],
    );
  }

  teardown() {
    this.abortController.abort();

    return this.serve as Promise<void>;
  }
}

export const syncDriverScenarios: Scenario<
  <F>(
    formats: FormatsArg<F>,
    appetite: SyncAppetite,
  ) => SyncDriverScenario<F>
>[] = [...universalPartners, {
  name: "Web",
  item: (formats, appetite) => new PartnerScenarioWeb(formats, appetite),
}];
