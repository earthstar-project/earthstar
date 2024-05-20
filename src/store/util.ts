import {
  ANY_SUBSPACE,
  AreaOfInterest,
  OPEN_END,
} from "@earthstar/willow-utils";
import {
  decodeIdentityTag,
  IdentityPublicKey,
} from "../identifiers/identity.ts";
import { isErr, ValidationError } from "../util/errors.ts";
import { Query } from "./types.ts";

const orderMap: Record<string, "subspace" | "path" | "timestamp"> = {
  "identity": "subspace",
  "path": "path",
  "timestamp": "timestamp",
};

export function queryToWillowQueryParams(query: Query): {
  areaOfInterest: AreaOfInterest<IdentityPublicKey>;
  order: "path" | "subspace" | "timestamp";
  reverse: boolean;
} | ValidationError {
  const identityPublicKey = query.identity
    ? decodeIdentityTag(query.identity)
    : undefined;

  if (isErr(identityPublicKey)) {
    return identityPublicKey;
  }

  return {
    areaOfInterest: {
      area: {
        pathPrefix: query.pathPrefix?.underlying || [],
        includedSubspaceId: identityPublicKey || ANY_SUBSPACE,
        timeRange: {
          start: query.timestampGte || 0n,
          end: query.timestampLt || OPEN_END,
        },
      },

      maxCount: query.limit || 0,
      maxSize: query.maxSize || 0n,
    },
    order: query.order ? orderMap[query.order] : "path",
    reverse: query.descending ? true : false,
  };
}
