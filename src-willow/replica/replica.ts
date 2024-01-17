import { Willow } from "../../deps.ts";

class Replica {
  constructor() {
    const willowReplica = new Willow.Replica({
      protocolParameters: {
        pathLengthEncoding: {
          encode(value) {
            return new Uint8Array([value]);
          },
          decode(encoded) {
            return encoded[1];
          },
          encodedLength: () => 1,
          maxLength: 256,
        },
        payloadScheme,
      },
    });
  }
}
