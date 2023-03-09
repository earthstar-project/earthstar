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
  private peer: Peer | null = null;

  constructor(opts: ExtensionServerSettingsOpts) {
    this.configReplica = opts.onCreateReplica(opts.settingsShare);
    this.onCreateReplica = opts.onCreateReplica;
  }

  register(peer: Peer): Promise<void> {
    this.peer = peer;
    peer.addReplica(this.configReplica);

    const onCreateReplica = this.onCreateReplica;
    const removeShareWithHash = this.removeShareWithHash.bind(this);

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
                // Add the share
                const replica = onCreateReplica(event.doc.text);

                peer.addReplica(replica);

                console.log("Server settings:", `now hosting ${replica.share}`);
              } else if (event.doc.text.length === 0) {
                // Remove the share
                await removeShareWithHash(shareHash);
              }
            }
          }

          if (event.kind === "expire") {
            if (
              regex != null &&
              new RegExp(regex).test(event.doc.path)
            ) {
              // Remove the share
              const pathVariables = extractTemplateVariablesFromPath(
                HOSTED_SHARE_TEMPLATE,
                event.doc.path,
              );

              if (!pathVariables) {
                return;
              }

              const shareHash = pathVariables["shareHash"];

              await removeShareWithHash(shareHash);
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

  async removeShareWithHash(hash: string) {
    const maybeReplicaForHash = await this.findReplicaForHash(hash);

    if (!maybeReplicaForHash) {
      return;
    }

    // Now we find all docs with this hash.
    // If any of them have text defined on them, we bail.

    const ephemeralDoc = await this.configReplica.queryDocs({
      filter: {
        pathStartsWith: "/server-settings/1.",
        pathEndsWith: `/shares/${hash}/host!`,
      },
    });

    const nonEphemeralDoc = await this.configReplica.queryDocs({
      filter: {
        pathStartsWith: "/server-settings/1.",
        pathEndsWith: `/shares/${hash}/host`,
      },
    });

    if (ephemeralDoc[0] && ephemeralDoc[0].text.length > 0) {
      return;
    }

    if (nonEphemeralDoc[0] && nonEphemeralDoc[0].text.length > 0) {
      return;
    }

    // Now we know all docs for this share are empty. Remove.
    await maybeReplicaForHash.close(true);
    this.peer?.removeReplica(maybeReplicaForHash);
    console.log(
      "Server settings:",
      `stopped hosting ${maybeReplicaForHash.share}`,
    );
  }

  async findReplicaForHash(hash: string): Promise<Replica | undefined> {
    for (const replica of this.peer?.replicas() || []) {
      const rHash = await Crypto.sha256base32(
        replica.share,
      );

      if (rHash === hash) {
        return replica;
      }
    }
  }
}
