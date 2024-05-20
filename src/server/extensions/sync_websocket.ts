import { IS_BETTY, TransportWebsocket } from "@earthstar/willow";
import { encodeShareTag } from "../../identifiers/share.ts";
import { Peer } from "../../peer/peer.ts";
import { Syncer } from "../../syncer/syncer.ts";
import { EarthstarError, isErr } from "../../util/errors.ts";
import { ServerExtension } from "./extension.ts";

export class ExtensionSyncWebsocket implements ServerExtension {
  private path = "";
  private peer = Promise.withResolvers<Peer>();

  constructor(path?: string) {
    if (path) {
      this.path = path;
    }
  }

  register(peer: Peer): Promise<void> {
    this.peer.resolve(peer);
    return Promise.resolve();
  }

  async handler(req: Request): Promise<Response | null> {
    const peer = await this.peer.promise;

    const syncPattern = new URLPattern({
      pathname: `/${this.path}`,
    });

    if (syncPattern.test(req.url) === false) {
      return null;
    }

    const { socket, response } = Deno.upgradeWebSocket(req);

    const transport = new TransportWebsocket(IS_BETTY, socket);

    new Syncer({
      auth: peer.auth,
      maxPayloadSizePower: 8,
      transport,
      interests: await peer.auth.interestsFromCaps(),
      getStore: async (share) => {
        const tag = encodeShareTag(share);

        const result = await peer.getStore(tag);

        if (isErr(result)) {
          throw new EarthstarError(
            "Could not get Store requested by Syncer.",
          );
        }

        return result;
      },
    });

    return response;
  }
}
