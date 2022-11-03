import {
  base64Decode,
  base64Encode,
  bytesEquals,
  RangeMessenger,
  RangeMessengerConfig,
} from "../../deps.ts";
import { DocThumbnailTree } from "./doc_thumbnail_tree.ts";
import { DocThumbnail, RangeMessage } from "./syncer_types.ts";

const encoding: RangeMessengerConfig<
  RangeMessage,
  DocThumbnail,
  Uint8Array
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
      fingerprint: base64Encode(fp),
      upperBound: y,
    }),
    terminal: () => ({
      type: "TERMINAL",
    }),
  },
  decode: {
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
          fingerprint: base64Decode(obj.fingerprint),
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
  extends RangeMessenger<RangeMessage, DocThumbnail, Uint8Array> {
  constructor(
    tree: DocThumbnailTree,
    payloadThreshold: number,
    rangeDivision: number,
  ) {
    super({
      tree,
      encoding,
      fingerprintEquals: bytesEquals,
      payloadThreshold,
      rangeDivision,
    });
  }
}
