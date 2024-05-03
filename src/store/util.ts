import { ANY_SUBSPACE, AreaOfInterest, OPEN_END } from "../../deps.ts";
import {
  decodeIdentityPublicKeyDisplay,
  IdentityPublicKey,
} from "../identifiers/identity.ts";
import { isErr, ValidationError } from "../util/errors.ts";
import { earthstarToWillowPath } from "../util/path.ts";
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
    ? decodeIdentityPublicKeyDisplay(query.identity)
    : undefined;

  if (isErr(identityPublicKey)) {
    return identityPublicKey;
  }

  const willowPath = earthstarToWillowPath(query.pathPrefix || []);

  if (isErr(willowPath)) {
    return willowPath;
  }

  return {
    areaOfInterest: {
      area: {
        pathPrefix: willowPath,
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
