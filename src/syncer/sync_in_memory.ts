import * as Willow from "@earthstar/willow";
import { encodeShareTag } from "../identifiers/share.ts";
import { Peer } from "../peer/peer.ts";
import { capSelectorsToCapPackSelectors } from "../peer/util.ts";
import { EarthstarError, isErr, ValidationError } from "../util/errors.ts";
import { Syncer } from "./syncer.ts";
import { CapSelector, RuntimeDriver } from "../peer/types.ts";

export async function syncInMemory(alfie: Peer, betty: Peer, opts: {
  alfieInterests?: CapSelector[];
  bettyInterests?: CapSelector[];
  runtime: RuntimeDriver;
}): Promise<(() => void) | ValidationError> {
  const [alfieTransport, bettyTransport] = Willow.transportPairInMemory();

  // @ts-ignore We are allowed to do this.
  const alfieAuth = alfie.auth;

  const alfieSelectors = opts?.alfieInterests
    ? capSelectorsToCapPackSelectors(opts.alfieInterests)
    : undefined;

  if (isErr(alfieSelectors)) {
    return alfieSelectors;
  }

  const messengerAlfie = new Syncer({
    auth: alfieAuth,
    getStore: async (share) => {
      const tag = encodeShareTag(share);

      const result = await alfie.getStore(tag);

      if (isErr(result)) {
        throw new EarthstarError(
          "Could not get Store requested by Syncer.",
        );
      }

      return result;
    },
    maxPayloadSizePower: 64,
    transport: alfieTransport,
    interests: await alfieAuth.interestsFromCaps(alfieSelectors),
    runtime: opts.runtime,
  });

  // @ts-ignore Me too.
  const bettyAuth = betty.auth;

  const bettySelectors = opts?.bettyInterests
    ? capSelectorsToCapPackSelectors(opts.bettyInterests)
    : undefined;

  if (isErr(bettySelectors)) {
    return bettySelectors;
  }

  const messengerBetty = new Syncer({
    auth: bettyAuth,
    getStore: async (share) => {
      const tag = encodeShareTag(share);

      const result = await betty.getStore(tag);

      if (isErr(result)) {
        throw new EarthstarError(
          "Could not get Store requested by Syncer.",
        );
      }

      return result;
    },
    maxPayloadSizePower: 64,
    transport: bettyTransport,
    interests: await bettyAuth.interestsFromCaps(bettySelectors),
    runtime: opts.runtime,
  });

  return () => {
    messengerAlfie.close();
    messengerBetty.close();
  };
}
