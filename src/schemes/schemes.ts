import { equalsBytes } from "../../../willow_utils/deps.ts";
import {
  bigintToBytes,
  concat,
  encodeEntry,
  EncodingScheme,
  Meadowcap,
  orderBytes,
  PathScheme,
  successorBytesFixedWidth,
  Willow,
} from "../../deps.ts";
import { blake3 } from "../blake3/blake3.ts";
import {
  decodeIdentityPublicKey,
  decodeStreamIdentityPublicKey,
  encodeIdentityPublicKey,
  IdentityKeypairRaw,
  IdentityPublicKey,
  identitySign,
  identityVerify,
} from "../identifiers/identity.ts";
import {
  decodeSharePublicKey,
  decodeStreamSharePublicKey,
  encodeSharePublicKey,
  isCommunalShare,
  SharePublicKey,
  shareSign,
  shareVerify,
} from "../identifiers/share.ts";
import { addBytes } from "../util/misc.ts";

export const namespaceScheme: Willow.NamespaceScheme<SharePublicKey> = {
  encode: (key) => encodeSharePublicKey(key),
  decode: (encoded) => decodeSharePublicKey(encoded),
  encodedLength: (key) => {
    const shortnameEncodedLength = key.shortname.length < 15
      ? key.shortname.length + 1
      : key.shortname.length;

    return shortnameEncodedLength + 32;
  },
  decodeStream: decodeStreamSharePublicKey,
  isEqual: (a, b) => {
    return (a.shortname === b.shortname &&
      equalsBytes(a.underlying, b.underlying));
  },
  defaultNamespaceId: {
    shortname: "a",
    underlying: new Uint8Array(32),
  },
};

export const subspaceScheme: Willow.SubspaceScheme<IdentityPublicKey> = {
  encode: (key) => encodeIdentityPublicKey(key),
  decode: (encoded) => decodeIdentityPublicKey(encoded),
  encodedLength: () => 4 + 32,
  decodeStream: (bytes) => decodeStreamIdentityPublicKey(bytes),
  successor: (identity) => {
    const nextPubkey = successorBytesFixedWidth(identity.underlying);

    if (nextPubkey) {
      return {
        shortname: identity.shortname,
        underlying: nextPubkey,
      };
    }

    const nextShortnameChars: string[] = identity.shortname.split("");

    for (let i = 0; i < identity.shortname.length; i++) {
      const charIndex = identity.shortname.length - 1 - i;

      const asciiCode = identity.shortname.charCodeAt(charIndex);

      const isAlpha = asciiCode >= 0x61 && asciiCode <= 0x7a;
      const isNumeric = asciiCode >= 0x30 && asciiCode <= 0x39;

      if ((isNumeric && asciiCode < 0x39) || (isAlpha && asciiCode < 0x7a)) {
        const nextCode = asciiCode + 1;
        nextShortnameChars[charIndex] = String.fromCharCode(nextCode);
        break;
      }
    }
    // Increment the name.
    const nextName = nextShortnameChars.join("");

    if (nextName === identity.shortname) {
      return null;
    }

    return {
      shortname: nextName,
      underlying: identity.underlying,
    };
  },
  order: (a, b) => {
    if (a.shortname < b.shortname) {
      return -1;
    } else if (a.shortname > b.shortname) {
      return 1;
    }

    return orderBytes(a.underlying, b.underlying);
  },
  minimalSubspaceId: {
    shortname: "a000",
    underlying: new Uint8Array(32),
  },
};

export const pathScheme: PathScheme = {
  maxPathLength: 1024,
  maxComponentCount: 16,
  maxComponentLength: 64,
};

export const payloadScheme: Willow.PayloadScheme<Uint8Array> = {
  encode: (digest) => digest,
  encodedLength: () => 32,
  decode: (encoded) => {
    return encoded.slice(0, 32);
  },
  decodeStream: async (bytes) => {
    await bytes.nextAbsolute(32);

    const digest = bytes.array.slice(
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
    return blake3(bytes);
  },
  defaultDigest: new Uint8Array(32),
};

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
  SharePublicKey,
  Uint8Array,
  Uint8Array,
  IdentityPublicKey,
  Uint8Array,
  Uint8Array,
  Uint8Array
> = {
  pathScheme,
  payloadScheme,
  isCommunal: isCommunalShare,
  namespaceKeypairScheme: {
    encodings: {
      publicKey: namespaceScheme,
      signature: signatureEncodingScheme,
    },
    signatures: {
      sign: (publicKey, secretKey, msg) => {
        return shareSign({
          publicKey,
          secretKey,
        }, msg);
      },
      verify: shareVerify,
    },
  },
  userScheme: {
    order: subspaceScheme.order,
    encodings: {
      publicKey: subspaceScheme,
      signature: signatureEncodingScheme,
    },
    signatures: {
      sign: (publicKey, secretKey, msg) => {
        return identitySign({
          publicKey,
          secretKey,
        }, msg);
      },
      verify: identityVerify,
    },
  },
};

const meadowcap = new Meadowcap.Meadowcap(meadowcapParams);

export const authorisationScheme: Willow.AuthorisationScheme<
  SharePublicKey,
  IdentityPublicKey,
  Uint8Array,
  {
    cap: Meadowcap.McCapability<
      SharePublicKey,
      IdentityPublicKey,
      Uint8Array,
      Uint8Array
    >;
    receiverKeypair: IdentityKeypairRaw;
  },
  Meadowcap.MeadowcapAuthorisationToken<
    SharePublicKey,
    IdentityPublicKey,
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

    const signature = await identitySign(opts.receiverKeypair, encoded);

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
  SharePublicKey,
  IdentityPublicKey,
  Uint8Array,
  Uint8Array,
  Uint8Array
> = {
  neutral: new Uint8Array(32),
  fingerprintSingleton: ({ entry, available }) => {
    const entryEnc = encodeEntry({
      namespaceScheme,
      pathScheme,
      payloadScheme,
      subspaceScheme,
    }, entry);

    const toHash = concat(entryEnc, bigintToBytes(available));

    return blake3(toHash);
  },
  fingerprintCombine: (a, b) => {
    return addBytes(new Uint8Array(a), new Uint8Array(b), 32);
  },
  fingerprintFinalise: (pre) => {
    return blake3(pre);
  },
  neutralFinalised: new Uint8Array(32),
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
