import { parseShareAddress } from "../../core-validators/addresses.ts";
import { Crypto } from "../../crypto/crypto.ts";
import { Peer } from "../../peer/peer.ts";
import {
  extractTemplateVariablesFromPath,
  globToQueryAndRegex,
  parseTemplate,
} from "../../query/query-helpers.ts";
import { Replica } from "../../replica/replica.ts";
import { ShareAddress } from "../../util/doc-types.ts";
import { notErr } from "../../util/errors.ts";
import { IServerExtension } from "./extension.ts";

interface ExtensionServerSettingsOpts {
  /** The address of the share to read settings from. */
  settingsShare: ShareAddress;
  /** The method used to create the replica for the settings share. */
  onCreateReplica: (
    settingsShareAddress: string,
  ) => Replica;
}

const HOSTED_SHARE_TEMPLATE =
  `/server-settings/1.*/shares/{shareHash}/{hostType}`;

/** A server extension which reads settings from a specified share, e.g. which shares to host on the server. Settings are modified by other peers syncing with this server. */
export class ExtensionServerSettings implements IServerExtension {
  private configReplica: Replica;
  private onCreateReplica: (
    configurationShareAddress: string,
  ) => Replica;

  constructor(opts: ExtensionServerSettingsOpts) {
    this.configReplica = opts.onCreateReplica(opts.settingsShare);
    this.onCreateReplica = opts.onCreateReplica;
  }

  register(peer: Peer): Promise<void> {
    peer.addReplica(this.configReplica);

    const onCreateReplica = this.onCreateReplica;

    const { glob } = parseTemplate(HOSTED_SHARE_TEMPLATE);
    const { query, regex } = globToQueryAndRegex(glob);

    const configShareAddress = this.configReplica.share;

    this.configReplica.getQueryStream(query, "everything").pipeTo(
      new WritableStream({
        async write(event) {
          if (event.kind === "existing" || event.kind === "success") {
            if (
              regex != null &&
              new RegExp(regex).test(event.doc.path)
            ) {
              const pathVariables = extractTemplateVariablesFromPath(
                HOSTED_SHARE_TEMPLATE,
                event.doc.path,
              );

              if (!pathVariables) {
                return;
              }

              const shareHash = pathVariables["shareHash"];

              const configHash = await Crypto.sha256base32(
                configShareAddress,
              );

              if (shareHash === configHash) {
                return;
              }

              if (
                event.doc.text.length > 0 &&
                notErr(parseShareAddress(event.doc.text)) &&
                !peer.hasShare(event.doc.text)
              ) {
                // Add
                const replica = onCreateReplica(event.doc.text);

                peer.addReplica(replica);

                console.log("Server settings:", `now hosting ${replica.share}`);
              } else if (event.doc.text.length === 0) {
                let replicaToClose;

                for (const replica of peer.replicas()) {
                  const rShareHash = await Crypto.sha256base32(
                    replica.share,
                  );

                  if (rShareHash === shareHash) {
                    replicaToClose = replica;
                  }
                }

                if (replicaToClose) {
                  await replicaToClose.close(true);
                  peer.removeReplica(replicaToClose);
                  console.log(
                    "Server settings:",
                    `stopped hosting ${replicaToClose.share}`,
                  );
                }
              }
            }
          }

          if (event.kind === "expire") {
            if (
              regex != null &&
              new RegExp(regex).test(event.doc.path)
            ) {
              // Remove
              const pathVariables = extractTemplateVariablesFromPath(
                HOSTED_SHARE_TEMPLATE,
                event.doc.path,
              );

              if (!pathVariables) {
                return;
              }

              const shareAddress = pathVariables["shareAddress"];

              const replicaToClose = peer.getReplica(shareAddress);

              if (replicaToClose) {
                await replicaToClose.close(true);
                peer.removeReplica(replicaToClose);
                console.log(
                  "Server settings:",
                  `stopped hosting ${replicaToClose.share}`,
                );
              }
            }
          }
        },
      }),
    );

    return Promise.resolve();
  }

  handler(_req: Request): Promise<Response | null> {
    return Promise.resolve(null);
  }
}
