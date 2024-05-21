import { ANY_SUBSPACE, type Area, OPEN_END } from "@earthstar/willow-utils";
import type { CapPackSelector } from "../auth/types.ts";
import {
  decodeIdentityTag,
  type IdentityPublicKey,
} from "../identifiers/identity.ts";
import { decodeShareTag } from "../identifiers/share.ts";
import { isErr, type ValidationError } from "../util/errors.ts";
import type { CapSelector } from "./types.ts";

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

    for (const area of selector.capableOf) {
      const subspace = area.identity
        ? decodeIdentityTag(area.identity)
        : undefined;

      if (isErr(subspace)) {
        return subspace;
      }

      areas.push({
        includedSubspaceId: subspace || ANY_SUBSPACE,
        pathPrefix: area.pathPrefix?.underlying || [],
        timeRange: area.time
          ? {
            start: BigInt(area.time.start),
            end: area.time.end ? BigInt(area.time.end) : OPEN_END,
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
