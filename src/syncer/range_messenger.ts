import {
  base64Decode,
  base64Encode,
  RangeMessenger,
  RangeMessengerConfig,
} from "../../deps.ts";
import { DocThumbnailTree } from "./doc_thumbnail_tree.ts";
import { DocThumbnail, RangeMessage } from "./syncer_types.ts";

const messengerConfig: RangeMessengerConfig<
  RangeMessage,
  DocThumbnail,
  Uint8Array
> = {
  encode: {
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
    lowerBound: (obj) => {
      if (obj.type === "LOWER_BOUND") {
        return obj.value;
      }

      return false;
    },

    payload: (obj) => {
      if (obj.type === "PAYLOAD") {
        return {
          value: obj.payload,
          ...(obj.end ? { end: obj.end } : {}),
        };
      }

      return false;
    },

    emptyPayload: (obj) => {
      if (obj.type === "EMPTY_PAYLOAD") {
        return obj.upperBound;
      }

      return false;
    },

    done: (obj) => {
      if (obj.type === "DONE") {
        return obj.upperBound;
      }

      return false;
    },
    fingerprint: (obj) => {
      if (obj.type === "FINGERPRINT") {
        return {
          fingerprint: base64Decode(obj.fingerprint),
          upperBound: obj.upperBound,
        };
      }

      return false;
    },
    terminal: (obj) => {
      if (obj.type === "TERMINAL") {
        return true;
      }

      return false;
    },
  },
};

export class EarthstarRangeMessenger
  extends RangeMessenger<RangeMessage, DocThumbnail, Uint8Array> {
  constructor(tree: DocThumbnailTree) {
    super(tree, messengerConfig);
  }
}
