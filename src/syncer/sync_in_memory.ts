import { Willow } from "../../deps.ts";
import { encodeShareTag } from "../identifiers/share.ts";
import { Peer } from "../peer/peer.ts";
import { EarthstarError, isErr } from "../util/errors.ts";
import { Syncer } from "./syncer.ts";

export async function syncInMemory(alfie: Peer, betty: Peer) {
  const [alfieTransport, bettyTransport] = Willow.transportPairInMemory();

  // @ts-ignore We are allowed to do this.
  const alfieAuth = alfie.auth;

  const messengerAlfie = new Syncer({
    auth: alfieAuth,
    getStore: async (share) => {
      const tag = encodeShareTag(share);

      const result = await alfie.getStore(tag);

      if (isErr(result)) {
        throw new EarthstarError(
          "Could not get Store requested by WgpsMessenger.",
        );
      }

      return result;
    },
    maxPayloadSizePower: 64,
    transport: alfieTransport,
    interests: await alfieAuth.interestsFromCaps(),
  });

  // @ts-ignore Me too.
  const bettyAuth = betty.auth;

  const messengerBetty = new Syncer({
    auth: bettyAuth,
    getStore: async (share) => {
      const tag = encodeShareTag(share);

      const result = await betty.getStore(tag);

      if (isErr(result)) {
        throw new EarthstarError(
          "Could not get Store requested by WgpsMessenger.",
        );
      }

      return result;
    },
    maxPayloadSizePower: 64,
    transport: bettyTransport,
    interests: await bettyAuth.interestsFromCaps(),
  });

  return () => {
    messengerAlfie.close();
    messengerBetty.close();
  };
}
