import { equalsBytes } from "../../../willow_utils/deps.ts";
import {
  bigintToBytes,
  concat,
  crypto,
  encodeEntry,
  EncodingScheme,
  Meadowcap,
  orderBytes,
  PathScheme,
  successorBytesFixedWidth,
  Willow,
} from "../../deps.ts";
import {
  assembleIdentityAddress,
  parseIdentityAddress,
  parseShareAddress,
  successorShortName,
} from "../core_validators/addresses.ts";

import { CryptoDriverWebExtractable } from "../crypto/drivers/webcrypto.ts";
import { IdentityAddress, ShareAddress } from "../crypto/types.ts";
import { decodeBase32, encodeBase32 } from "../encoding/base32.ts";
import { EarthstarError, isErr } from "../util/errors.ts";
import { addBytes } from "../util/misc.ts";

export const namespaceScheme: Willow.NamespaceScheme<ShareAddress> = {
  encode: (address) => {
    const parsed = parseShareAddress(address);

    if (isErr(parsed)) {
      throw parsed;
    }

    const [sigil] = address;

    const isCommunal = sigil === "+";

    // Communal / Owned

    const encodedShortName = new TextEncoder().encode(parsed.name);

    // Shortname
    // Pubkey
    return concat(
      // Is communal or not
      new Uint8Array([isCommunal ? 0 : 1]),
      // 8-bit shortname length
      new Uint8Array([encodedShortName.byteLength]),
      // The encoded shortname
      encodedShortName,
      // The pubkey
      decodeBase32(parsed.pubkey),
    );
  },
  decode: (encoded) => {
    const isCommunal = encoded[0] === 0;

    const shortnameLength = encoded[1];

    const shortnameBytes = encoded.subarray(2, 2 + shortnameLength);

    const pubkeyBytes = encoded.subarray(
      2 + shortnameLength,
      2 + shortnameLength + 32,
    );

    return `${isCommunal ? "+" : "-"}${
      new TextDecoder().decode(shortnameBytes)
    }.${encodeBase32(pubkeyBytes)}`;
  },
  encodedLength: (address) => {
    const parsed = parseShareAddress(address);

    if (isErr(parsed)) {
      throw parsed;
    }

    // Communal / Owned

    const encodedShortName = new TextEncoder().encode(parsed.name);

    return 1 + 1 + encodedShortName.byteLength + 32;
  },
  decodeStream: async (bytes) => {
    await bytes.nextAbsolute(1);

    const isCommunal = bytes.array[0] === 0;

    await bytes.nextAbsolute(2);

    const shortnameLength = bytes.array[1];

    await bytes.nextAbsolute(2 + shortnameLength);

    const shortnameBytes = bytes.array.subarray(2, 2 + shortnameLength);

    await bytes.nextAbsolute(2 + shortnameLength + 32);

    const pubkeyBytes = bytes.array.subarray(
      2 + shortnameLength,
      2 + shortnameLength + 32,
    );

    bytes.prune(2 + shortnameLength + 32);

    return `${isCommunal ? "+" : "-"}${
      new TextDecoder().decode(shortnameBytes)
    }.${encodeBase32(pubkeyBytes)}`;
  },
  isEqual: (a, b) => {
    return a === b;
  },
  defaultNamespaceId:
    "@0.baaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

export const subspaceScheme: Willow.SubspaceScheme<IdentityAddress> = {
  encode: (identity) => {
    const parsed = parseIdentityAddress(identity);

    if (isErr(parsed)) {
      throw parsed;
    }

    const nameBytes = new TextEncoder().encode(parsed.name);
    const pubKeyBytes = decodeBase32(parsed.pubkey);

    return concat(nameBytes, pubKeyBytes);
  },
  decode: (encoded) => {
    const nameBytes = encoded.subarray(0, 4);
    const pubKeyBytes = encoded.subarray(4);

    const name = new TextDecoder().decode(nameBytes);
    const pubKey = encodeBase32(pubKeyBytes);

    return assembleIdentityAddress(name, pubKey);
  },
  encodedLength: () => 4 + 32,
  decodeStream: async (bytes) => {
    await bytes.nextAbsolute(4);

    const nameBytes = bytes.array.subarray(0, 4);
    const name = new TextDecoder().decode(nameBytes);

    await bytes.nextAbsolute(4 + 32);

    const pubKeyBytes = bytes.array.subarray(4, 4 + 32);
    const pubKey = encodeBase32(pubKeyBytes);

    bytes.prune(4 + 32);

    return assembleIdentityAddress(name, pubKey);
  },
  successor: (identity) => {
    const parsed = parseIdentityAddress(identity);

    if (isErr(parsed)) {
      throw parsed;
    }

    const pubkey = decodeBase32(parsed.pubkey);

    const nextBytes = successorBytesFixedWidth(pubkey);

    if (nextBytes) {
      const encoded = encodeBase32(nextBytes);

      return assembleIdentityAddress(parsed.name, encoded);
    }

    // Increment the name.
    const nextName = successorShortName(parsed.name);

    if (!nextName) {
      return null;
    }

    return assembleIdentityAddress(nextName, parsed.pubkey);
  },
  order: (a, b) => {
    const parsedA = parseIdentityAddress(a);
    const parsedB = parseIdentityAddress(b);

    if (isErr(parsedA)) {
      throw parsedA;
    }

    if (isErr(parsedB)) {
      throw parsedB;
    }

    if (parsedA.name < parsedB.name) {
      return -1;
    } else if (parsedA.name > parsedB.name) {
      return 1;
    }

    const pubKeyA = decodeBase32(parsedA.pubkey);
    const pubKeyB = decodeBase32(parsedB.pubkey);

    return orderBytes(pubKeyA, pubKeyB);
  },
  minimalSubspaceId:
    `@a000.baaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`,
};

export const pathScheme: PathScheme = {
  maxPathLength: 255,
  maxComponentCount: 31,
  maxComponentLength: 255,
};

export const payloadScheme: Willow.PayloadScheme<ArrayBuffer> = {
  encode: (digest) => {
    return new Uint8Array(digest);
  },
  encodedLength: () => 32,
  decode: (encoded) => {
    return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + 32);
  },
  decodeStream: async (bytes) => {
    await bytes.nextAbsolute(32);

    const digest = bytes.array.buffer.slice(
      bytes.array.byteOffset,
      bytes.array.byteOffset + 32,
    );

    bytes.prune(32);

    return digest;
  },
  order: (a, b) => {
    return orderBytes(new Uint8Array(a), new Uint8Array(b));
  },
  fromBytes: (bytes) => {
    return crypto.subtle.digest("SHA-256", bytes);
  },
  defaultDigest: new Uint8Array([
    227,
    176,
    196,
    66,
    152,
    252,
    28,
    20,
    154,
    251,
    244,
    200,
    153,
    111,
    185,
    36,
    39,
    174,
    65,
    228,
    100,
    155,
    147,
    76,
    164,
    149,
    153,
    27,
    120,
    82,
    184,
    85,
  ]),
};

const cryptoDriver = new CryptoDriverWebExtractable();

export const signatureEncodingScheme: EncodingScheme<Uint8Array> = {
  encode: (sig) => sig,
  encodedLength: () => 64,
  decode: (enc) => enc.slice(0, 64),
  decodeStream: async (bytes) => {
    await bytes.nextAbsolute(64);

    const sig = bytes.array.slice(0, 64);

    bytes.prune(64);

    return sig;
  },
};

export const meadowcapParams: Meadowcap.MeadowcapParams<
  ShareAddress,
  Uint8Array,
  Uint8Array,
  IdentityAddress,
  Uint8Array,
  Uint8Array,
  ArrayBuffer
> = {
  pathScheme,
  payloadScheme,
  isCommunal: (address) => {
    const parsed = parseShareAddress(address);

    if (isErr(parsed)) {
      throw parsed;
    }

    const pubkey = decodeBase32(parsed.pubkey);

    const isCommunal = (pubkey[pubkey.byteLength - 1] & 0x1) === 0x0;

    const [sigil] = address;

    if (sigil === "+" && isCommunal) {
      return true;
    } else if (sigil === "-" && !isCommunal) {
      return false;
    }

    throw new EarthstarError(
      "Invalid share address - wrong sigil and pubkey combination",
    );
  },
  namespaceKeypairScheme: {
    encodings: {
      publicKey: namespaceScheme,
      signature: signatureEncodingScheme,
    },
    signatures: {
      sign: cryptoDriver.sign,
      verify: (address, sig, msg) => {
        const parsed = parseShareAddress(address);

        if (isErr(parsed)) {
          throw parsed;
        }

        const publicKey = decodeBase32(parsed.pubkey);

        return cryptoDriver.verify(publicKey, sig, msg);
      },
    },
  },
  userScheme: {
    order: subspaceScheme.order,
    encodings: {
      publicKey: subspaceScheme,
      signature: signatureEncodingScheme,
    },
    signatures: {
      sign: cryptoDriver.sign,
      verify: (address, sig, msg) => {
        const parsed = parseIdentityAddress(address);

        if (isErr(parsed)) {
          throw parsed;
        }

        const publicKey = decodeBase32(parsed.pubkey);

        return cryptoDriver.verify(publicKey, sig, msg);
      },
    },
  },
};

const meadowcap = new Meadowcap.Meadowcap(meadowcapParams);

export const authorisationScheme: Willow.AuthorisationScheme<
  ShareAddress,
  IdentityAddress,
  ArrayBuffer,
  {
    cap: Meadowcap.McCapability<
      ShareAddress,
      IdentityAddress,
      Uint8Array,
      Uint8Array
    >;
    // Should we maybe get the secret from a store that knows about the receiver...?
    receiverSecret: Uint8Array;
  },
  Meadowcap.MeadowcapAuthorisationToken<
    ShareAddress,
    IdentityAddress,
    Uint8Array,
    Uint8Array
  >
> = {
  isAuthorisedWrite: (entry, token) => {
    return meadowcap.isAuthorisedWrite(entry, token);
  },

  authorise: async (entry, opts) => {
    const encoded = encodeEntry({
      namespaceScheme,
      subspaceScheme,
      payloadScheme,
      pathScheme,
    }, entry);

    const signature = await cryptoDriver.sign(encoded, opts.receiverSecret);

    return {
      capability: opts.cap,
      signature,
    };
  },

  tokenEncoding: {
    encode: (token) => {
      return concat(
        token.signature,
        Meadowcap.encodeMcCapability({
          encodingNamespace: namespaceScheme,
          encodingNamespaceSig: signatureEncodingScheme,
          encodingUser: subspaceScheme,
          encodingUserSig: signatureEncodingScheme,
          orderSubspace: subspaceScheme.order,
          pathScheme,
        }, token.capability),
      );
    },
    decode: (encoded) => {
      const signature = encoded.subarray(0, 64);
      const capability = Meadowcap.decodeMcCapability({
        encodingNamespace: namespaceScheme,
        encodingNamespaceSig:
          meadowcapParams.namespaceKeypairScheme.encodings.signature,
        encodingUser: subspaceScheme,
        encodingUserSig: meadowcapParams.userScheme.encodings.signature,
        orderSubspace: subspaceScheme.order,
        pathScheme: pathScheme,
      }, encoded.subarray(64));

      return {
        capability,
        signature,
      };
    },
    encodedLength: (token) => {
      // TODO Implement a real encodeMcCapabilityLength
      return 32 + Meadowcap.encodeMcCapability({
        encodingNamespace: namespaceScheme,
        encodingNamespaceSig: signatureEncodingScheme,
        encodingUser: subspaceScheme,
        encodingUserSig: signatureEncodingScheme,
        orderSubspace: subspaceScheme.order,
        pathScheme,
      }, token.capability).byteLength;
    },
    decodeStream: async (bytes) => {
      await bytes.nextAbsolute(32);

      const signature = bytes.array.slice(0, 32);

      bytes.prune(32);

      const capability = await Meadowcap.decodeStreamMcCapability({
        encodingNamespace: namespaceScheme,
        encodingNamespaceSig:
          meadowcapParams.namespaceKeypairScheme.encodings.signature,
        encodingUser: subspaceScheme,
        encodingUserSig: meadowcapParams.userScheme.encodings.signature,
        orderSubspace: subspaceScheme.order,
        pathScheme: pathScheme,
      }, bytes);

      return {
        capability,
        signature,
      };
    },
  },
};

export const fingerprintScheme: Willow.FingerprintScheme<
  ShareAddress,
  IdentityAddress,
  ArrayBuffer,
  ArrayBuffer
> = {
  neutral: new ArrayBuffer(32),
  fingerprintSingleton: ({ entry, available }) => {
    const entryEnc = encodeEntry({
      namespaceScheme,
      pathScheme,
      payloadScheme,
      subspaceScheme,
    }, entry);

    const toHash = concat(entryEnc, bigintToBytes(available));

    return crypto.subtle.digest("SHA-256", toHash);
  },
  fingerprintCombine: (a, b) => {
    return addBytes(new Uint8Array(a), new Uint8Array(b), 32);
  },
  isEqual: (a, b) => {
    return equalsBytes(new Uint8Array(a), new Uint8Array(b));
  },
  encoding: {
    encode: (fp) => {
      return new Uint8Array(fp);
    },
    decode: (bytes) => {
      return bytes.subarray(0, 32);
    },
    decodeStream: async (bytes) => {
      await bytes.nextAbsolute(32);

      const fingerprint = bytes.array.slice(0, 32);

      bytes.prune(32);

      return fingerprint;
    },
    encodedLength: () => 32,
  },
};
