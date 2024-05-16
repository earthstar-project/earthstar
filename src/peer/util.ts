import { ANY_SUBSPACE, Area, OPEN_END } from "../../deps.ts";
import { CapPackSelector } from "../auth/types.ts";
import {
  decodeIdentityTag,
  IdentityPublicKey,
} from "../identifiers/identity.ts";
import { decodeShareTag } from "../identifiers/share.ts";
import { isErr, ValidationError } from "../util/errors.ts";
import { CapSelector } from "./peer.ts";

export function capSelectorsToCapPackSelectors(
  selectors: CapSelector[],
): CapPackSelector[] | ValidationError {
  const capPackSelectors: CapPackSelector[] = [];

  for (const selector of selectors) {
    const sharePublicKey = decodeShareTag(selector.share);

    if (isErr(sharePublicKey)) {
      return sharePublicKey;
    }

    const areas: Area<IdentityPublicKey>[] = [];

    if (!selector.capableOf) {
      capPackSelectors.push({
        share: sharePublicKey,
      });
      continue;
    }

    for (const hmmm of selector.capableOf) {
      const subspace = hmmm.identity
        ? decodeIdentityTag(hmmm.identity)
        : undefined;

      if (isErr(subspace)) {
        return subspace;
      }

      areas.push({
        includedSubspaceId: subspace || ANY_SUBSPACE,
        pathPrefix: hmmm.pathPrefix || [],
        timeRange: hmmm.time
          ? {
            start: BigInt(hmmm.time.start),
            end: hmmm.time.end ? BigInt(hmmm.time.end) : OPEN_END,
          }
          : {
            start: 0n,
            end: OPEN_END,
          },
      });
    }

    capPackSelectors.push({
      share: sharePublicKey,
      areas,
    });
  }

  return capPackSelectors;
}
