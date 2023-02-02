import { RangeMessenger, RangeMessengerConfig } from "../../deps.ts";
import { bigIntFromHex, bigIntToHex } from "../util/bigint.ts";
import { DocThumbnailTree } from "./doc_thumbnail_tree.ts";
import { DocThumbnail, RangeMessage } from "./syncer_types.ts";

const TYPE_MAPPINGS = {
  "EMPTY_SET": "emptySet" as const,
  "LOWER_BOUND": "lowerBound" as const,
  "PAYLOAD": "payload" as const,
  "EMPTY_PAYLOAD": "emptyPayload" as const,
  "DONE": "done" as const,
  "FINGERPRINT": "fingerprint" as const,
  "TERMINAL": "terminal" as const,
};

const encoding: RangeMessengerConfig<
  RangeMessage,
  DocThumbnail,
  bigint
> = {
  encode: {
    emptySet: (canRespond) => ({
      type: "EMPTY_SET",
      canRespond,
    }),
    lowerBound: (x) => ({
      type: "LOWER_BOUND",
      value: x,
    }),
    payload: (v, end) => ({
      type: "PAYLOAD",
      payload: v,
      ...(end ? { end } : {}),
    }),
    emptyPayload: (upperBound) => ({
      type: "EMPTY_PAYLOAD",
      upperBound,
    }),
    done: (y) => ({
      type: "DONE",
      upperBound: y,
    }),
    fingerprint: (fp, y) => ({
      type: "FINGERPRINT",
      fingerprint: bigIntToHex(fp),
      upperBound: y,
    }),
    terminal: () => ({
      type: "TERMINAL",
    }),
  },
  decode: {
    getType: (obj) => {
      return TYPE_MAPPINGS[obj.type];
    },
    emptySet: (obj) => {
      if (obj.type === "EMPTY_SET") {
        return obj.canRespond;
      }
      throw "Can't decode";
    },
    lowerBound: (obj) => {
      if (obj.type === "LOWER_BOUND") {
        return obj.value;
      }
      throw "Can't decode";
    },
    payload: (obj) => {
      if (obj.type === "PAYLOAD") {
        return {
          value: obj.payload,
          ...(obj.end ? { end: obj.end } : {}),
        };
      }
      throw "Can't decode";
    },
    emptyPayload: (obj) => {
      if (obj.type === "EMPTY_PAYLOAD") {
        return obj.upperBound;
      }
      throw "Can't decode";
    },
    done: (obj) => {
      if (obj.type === "DONE") {
        return obj.upperBound;
      }
      throw "Can't decode";
    },
    fingerprint: (obj) => {
      if (obj.type === "FINGERPRINT") {
        return {
          fingerprint: bigIntFromHex(obj.fingerprint),
          upperBound: obj.upperBound,
        };
      }
      throw "Can't decode";
    },
    terminal: (obj) => {
      if (obj.type === "TERMINAL") {
        return true;
      }
      throw "Can't decode";
    },
  },
};

export class EarthstarRangeMessenger
  extends RangeMessenger<RangeMessage, DocThumbnail, bigint> {
  constructor(
    tree: DocThumbnailTree,
    payloadThreshold: number,
    rangeDivision: number,
  ) {
    super({
      tree,
      encoding,
      fingerprintEquals: (a, b) => a === b,
      payloadThreshold,
      rangeDivision,
    });
  }
}
