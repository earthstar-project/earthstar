import { concat } from "https://deno.land/std@0.184.0/bytes/concat.ts";

export class DecryptionStream {
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

class EncryptStream {
  private transform: TransformStream<Uint8Array, Uint8Array>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;

  constructor(derivedKey: CryptoKey) {
    this.transform = new TransformStream<Uint8Array, Uint8Array>({
      async transform(chunk, controller) {
        const iv = crypto.getRandomValues(new Uint8Array(12));

        const encryptedBytes = await crypto.subtle.encrypt(
          {
            name: "AES-GCM",
            iv: iv,
          },
          derivedKey,
          chunk,
        );

        controller.enqueue(concat(iv, new Uint8Array(encryptedBytes)));
      },
    });

    this.readable = this.transform.readable;
    this.writable = this.transform.writable;
  }
}

class AddEncryptedLengthDelimitStream {
  private transform: TransformStream<Uint8Array, Uint8Array>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;

  constructor(derivedKey: CryptoKey) {
    this.transform = new TransformStream<Uint8Array, Uint8Array>({
      async transform(chunk, controller) {
        const length = chunk.byteLength;
        const lengthBytes = new Uint8Array(4);
        const view = new DataView(lengthBytes.buffer);
        view.setUint32(0, length);

        const iv = crypto.getRandomValues(new Uint8Array(12));

        const encryptedLengthBytes = await crypto.subtle.encrypt(
          {
            name: "AES-GCM",
            iv: iv,
          },
          derivedKey,
          lengthBytes,
        );

        controller.enqueue(
          concat(iv, new Uint8Array(encryptedLengthBytes), chunk),
        );
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

class DecryptLengthDelimitStream {
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
      const together = concat(newBytes, carryOver.unfinishedLengthBytes);

      const lengthResult = await this.getLength(together);

      if (lengthResult === false) {
        this.setCarryOver({
          unfinishedLengthBytes: together,
        });

        return;
      }

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

      desiredLength = lengthResult.length;
      bytesToWorkWith = lengthResult.leftover;
    }

    if (desiredLength > bytesToWorkWith.byteLength) {
      this.setCarryOver({
        unfinishedBytes: bytesToWorkWith,
        remaining: isUnfinishedMessage(carryOver)
          ? carryOver.remaining - bytesToWorkWith.byteLength
          : desiredLength,
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

    return {
      length,
      leftover: bytes.subarray(12 + 20),
    };
  }
}

class CollateStream {
  private transform: TransformStream<Uint8Array, Uint8Array>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;

  private collated: Uint8Array = new Uint8Array(0);

  constructor() {
    const limit = 3;

    const getCollated = this.getCollated.bind(this);
    const setCollated = this.setCollated.bind(this);
    this.transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        const together = concat(getCollated(), chunk);

        if (together.byteLength >= limit) {
          controller.enqueue(together);
          setCollated(new Uint8Array(0));
        } else {
          setCollated(together);
        }
      },
      flush(controller) {
        const collated = getCollated();

        if (collated.byteLength > 0) {
          controller.enqueue(getCollated());
        }
      },
    });

    this.readable = this.transform.readable;
    this.writable = this.transform.writable;
  }

  getCollated() {
    return this.collated;
  }

  setCollated(collated: Uint8Array) {
    this.collated = collated;
  }
}

const keyPair = await crypto.subtle.generateKey(
  {
    name: "ECDH",
    namedCurve: "P-256",
  },
  true,
  ["deriveKey", "deriveBits"],
);

const publicKeyExported = await crypto.subtle.exportKey(
  "raw",
  keyPair.publicKey,
);

const publicKeyImported = await crypto.subtle.importKey(
  "raw",
  publicKeyExported,
  {
    name: "ECDH",
    namedCurve: "P-256",
  },
  true,
  [],
);

// Derive a new thing

const keyPair2 = await crypto.subtle.generateKey(
  {
    name: "ECDH",
    namedCurve: "P-256",
  },
  true,
  ["deriveKey", "deriveBits"],
);

const derivedKey = await crypto.subtle.deriveKey(
  { name: "ECDH", public: publicKeyImported },
  keyPair2.privateKey,
  { name: "AES-GCM", length: 256 },
  true,
  ["encrypt", "decrypt"],
);

const messages = [
  "Hello!",
  "I'm sending you some encrypted messages...",
  "Unless you know our derived secret, you won't be able to read them...",
  "or know how many there are!",
];

const stream = new ReadableStream({
  start(controller) {
    for (const message of messages) {
      controller.enqueue(message);
    }

    controller.close();
  },
});

await stream
  .pipeThrough(new TextEncoderStream())
  .pipeThrough(new EncryptStream(derivedKey))
  .pipeThrough(new AddEncryptedLengthDelimitStream(derivedKey))
  .pipeThrough(new CollateStream())
  .pipeThrough(new DecryptLengthDelimitStream(derivedKey))
  .pipeThrough(new DecryptionStream(derivedKey))
  .pipeThrough(new TextDecoderStream())
  .pipeTo(
    new WritableStream({
      write(text) {
        console.log(`%c${text}`, "color: green");
      },
    }),
  );
