import { concat } from "../../deps.ts";

/** Decrypts discrete encrypted chunks prefixed with a 12 byte initialisation value.  */
export class DecryptStream {
  private transform: TransformStream<Uint8Array, Uint8Array>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;

  constructor(derivedKey: CryptoKey) {
    this.transform = new TransformStream<Uint8Array, Uint8Array>({
      async transform(chunk, controller) {
        if (chunk.byteLength === 0) {
          return;
        }

        const decrypted = await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: chunk.subarray(0, 12),
          },
          derivedKey,
          chunk.subarray(12, undefined),
        );

        controller.enqueue(new Uint8Array(decrypted));
      },
    });

    this.readable = this.transform.readable;
    this.writable = this.transform.writable;
  }
}

type UnfinishedLength = {
  unfinishedLengthBytes: Uint8Array;
};

type UnfinishedMessage = {
  remaining: number;
  unfinishedBytes: Uint8Array;
};

function isUnfinishedLength(
  o: UnfinishedLength | UnfinishedMessage | null,
): o is UnfinishedLength {
  if (o === null) {
    return false;
  }

  return "unfinishedLengthBytes" in o;
}

function isUnfinishedMessage(
  o: UnfinishedLength | UnfinishedMessage | null,
): o is UnfinishedMessage {
  if (o === null) {
    return false;
  }

  return "unfinishedBytes" in o;
}

/** Given a stream of potentially multiple and / or truncated chunks with an encrypted length delimiter, finds encrypted length delimiters and uses that to enqueue discrete chunks */
export class DecryptLengthDelimitStream {
  private transform: TransformStream<Uint8Array, Uint8Array>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;

  private carryOver:
    | UnfinishedLength
    | UnfinishedMessage
    | null = null;
  private derivedKey: CryptoKey;

  constructor(derivedKey: CryptoKey) {
    this.derivedKey = derivedKey;

    const getCarryOver = this.getCarryOver.bind(this);
    const setCarryOver = this.setCarryOver.bind(this);
    const delimit = this.delimit.bind(this);

    this.transform = new TransformStream<Uint8Array, Uint8Array>({
      async transform(chunk, controller) {
        const carryOver = getCarryOver();
        setCarryOver(null);

        await delimit(
          chunk,
          carryOver,
          (bytes: Uint8Array) => controller.enqueue(bytes),
        );
      },
    });

    this.readable = this.transform.readable;
    this.writable = this.transform.writable;
  }

  private getCarryOver() {
    return this.carryOver;
  }

  private setCarryOver(
    carryOver:
      | UnfinishedLength
      | UnfinishedMessage
      | null,
  ) {
    this.carryOver = carryOver;
  }

  private async delimit(
    newBytes: Uint8Array,
    carryOver: UnfinishedLength | UnfinishedMessage | null,
    enqueue: (bytes: Uint8Array) => void,
  ) {
    let desiredLength: number;
    let bytesToWorkWith: Uint8Array;

    if (isUnfinishedLength(carryOver)) {
      const together = concat(carryOver.unfinishedLengthBytes, newBytes);

      const lengthResult = await this.getLength(together);

      if (lengthResult === false) {
        this.setCarryOver({
          unfinishedLengthBytes: together,
        });

        return;
      }

      this.setCarryOver(null);

      desiredLength = lengthResult.length;
      bytesToWorkWith = lengthResult.leftover;
    } else if (isUnfinishedMessage(carryOver)) {
      desiredLength = carryOver.remaining;
      bytesToWorkWith = concat(carryOver.unfinishedBytes, newBytes);
    } else {
      const lengthResult = await this.getLength(newBytes);

      if (lengthResult === false) {
        this.setCarryOver({
          unfinishedLengthBytes: newBytes,
        });

        return;
      }

      this.setCarryOver(null);

      desiredLength = lengthResult.length;
      bytesToWorkWith = lengthResult.leftover;
    }

    if (desiredLength > bytesToWorkWith.byteLength) {
      this.setCarryOver({
        unfinishedBytes: bytesToWorkWith,
        remaining: desiredLength,
      });

      return;
    } else {
      const desiredBytes = bytesToWorkWith.subarray(0, desiredLength);
      const remaining = bytesToWorkWith.subarray(desiredLength);

      enqueue(desiredBytes);

      if (remaining.byteLength > 0) {
        await this.delimit(remaining, null, enqueue);
      }
    }
  }

  private async getLength(
    bytes: Uint8Array,
  ): Promise<{ length: number; leftover: Uint8Array } | false> {
    // Length of IV and tagged encrypted length

    if (bytes.byteLength < 12 + 20) {
      return false;
    }

    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytes.subarray(0, 12),
      },
      this.derivedKey,
      bytes.subarray(12, 12 + 20),
    );

    const view = new DataView(decrypted);
    const length = view.getUint32(0);

    // console.log("decrypted length", length);

    return {
      length,
      leftover: bytes.subarray(12 + 20),
    };
  }
}
