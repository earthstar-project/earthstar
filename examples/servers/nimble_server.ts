import { parse } from "https://deno.land/std@0.119.0/flags/mod.ts";
import {
  AttachmentDriverFilesystem,
  DocDriverSqlite,
  ExtensionServerSettings,
  ExtensionSyncWeb,
} from "../../src/entries/deno.ts";
import { Replica } from "../../src/replica/replica.ts";
import { Server, ServerOpts } from "../../src/server/server.ts";

const flags = parse(Deno.args, {
  string: ["port", "hostname"],
  default: {
    port: 8080,
    hostname: "0.0.0.0",
  },
});

export class NimbleServer {
  private server: Server;

  constructor(opts: ServerOpts) {
    this.server = new Server([
      new ExtensionServerSettings({
        configurationShare:
          "+apples.btqswluholq6on2ci5mck66uzkmumb5uszgvqimtshff2f6zy5etq",
        onCreateReplica: (shareAddress) => {
          return new Replica(
            {
              driver: {
                docDriver: new DocDriverSqlite({
                  share: shareAddress,
                  filename: `./data/${shareAddress}.sql`,
                  mode: "create-or-open",
                }),
                attachmentDriver: new AttachmentDriverFilesystem(
                  `./data/${shareAddress}_attachments`,
                ),
              },
            },
          );
        },
      }),
      new ExtensionSyncWeb({ path: "/sync" }),
    ], opts);
  }

  close() {
    return this.server.close();
  }
}

console.log(`Started Nimble server on ${flags.hostname}:${flags.port}`);

const server = new NimbleServer({
  hostname: flags.hostname,
  port: flags.port,
});
