import type * as Willow from "@earthstar/willow";

import { concat, equals as equalsBytes } from "@std/bytes";
import {
  ANY_SUBSPACE,
  encodeCompactWidth,
  encodeEntry,
  encodePath,
  type EncodingScheme,
  orderBytes,
  type PathScheme,
  successorBytesFixedWidth,
} from "@earthstar/willow-utils";
import * as Meadowcap from "@earthstar/meadowcap";
import { ed25519, hashToCurve, x25519 } from "@noble/curves/ed25519";
import { ExtPointConstructor } from "@noble/curves/abstract/edwards";
import type { Auth, AuthorisationToken } from "../auth/auth.ts";
import type { SubspaceCapability } from "../caps/types.ts";
import {
  decodeIdentityPublicKey,
  decodeStreamIdentityPublicKey,
  encodeIdentityPublicKey,
  type IdentityKeypairRaw,
  type IdentityPublicKey,
  identitySign,
  identityVerify,
} from "../identifiers/identity.ts";
import {
  decodeSharePublicKey,
  decodeStreamSharePublicKey,
  encodeSharePublicKey,
  isCommunalShare,
  type SharePublicKey,
  shareSign,
  shareVerify,
} from "../identifiers/share.ts";
import { EarthstarError } from "../util/errors.ts";
import type { PreFingerprint } from "../store/types.ts";
import type { Blake3Driver } from "../blake3/types.ts";
import type { Ed25519Driver } from "../cinn25519/types.ts";
import { ExtendedPoint } from "@noble/ed25519";

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

export function makePayloadScheme(
  blake3: Blake3Driver,
): Willow.PayloadScheme<Uint8Array> {
  return {
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
}

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

export function makeMeadowcapParams(
  ed25519: Ed25519Driver<Uint8Array>,
  blake3: Blake3Driver,
): Meadowcap.MeadowcapParams<
  SharePublicKey,
  Uint8Array,
  Uint8Array,
  IdentityPublicKey,
  Uint8Array,
  Uint8Array,
  Uint8Array
> {
  return {
    pathScheme,
    payloadScheme: makePayloadScheme(blake3),
    isCommunal: isCommunalShare,
    namespaceKeypairScheme: {
      encodings: {
        publicKey: namespaceScheme,
        signature: signatureEncodingScheme,
      },
      signatures: {
        sign: (publicKey, secretKey, msg) => {
          return shareSign(
            {
              publicKey,
              secretKey,
            },
            msg,
            ed25519,
          );
        },
        verify: (publicKey, signature, bytestring) => {
          return shareVerify(publicKey, signature, bytestring, ed25519);
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
        sign: (publicKey, secretKey, msg) => {
          return identitySign(
            {
              publicKey,
              secretKey,
            },
            msg,
            ed25519,
          );
        },
        verify: (publicKey, signature, bytestring) => {
          return identityVerify(publicKey, signature, bytestring, ed25519);
        },
      },
    },
  };
}

export type AuthorizationScheme = Willow.AuthorisationScheme<
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
>;

export function makeAuthorisationScheme(
  ed25519: Ed25519Driver<Uint8Array>,
  blake3: Blake3Driver,
): AuthorizationScheme {
  const meadowcapParams = makeMeadowcapParams(ed25519, blake3);
  const meadowcap = new Meadowcap.Meadowcap(
    meadowcapParams,
  );

  return {
    isAuthorisedWrite: (entry, token) => {
      return meadowcap.isAuthorisedWrite(entry, token);
    },

    authorise: async (entry, opts) => {
      const encoded = encodeEntry({
        encodeNamespace: namespaceScheme.encode,
        encodeSubspace: subspaceScheme.encode,
        encodePayload: (digest) => digest,
        pathScheme,
      }, entry);

      const signature = await identitySign(
        opts.receiverKeypair,
        encoded,
        ed25519,
      );

      return {
        capability: opts.cap,
        signature,
      };
    },

    tokenEncoding: {
      encode: (token) => {
        return concat(
          [
            token.signature,
            Meadowcap.encodeMcCapability({
              encodingNamespace: namespaceScheme,
              encodingNamespaceSig: signatureEncodingScheme,
              encodingUser: subspaceScheme,
              encodingUserSig: signatureEncodingScheme,
              orderSubspace: subspaceScheme.order,
              pathScheme,
            }, token.capability),
          ],
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
        return 64 + Meadowcap.encodeMcCapability({
          encodingNamespace: namespaceScheme,
          encodingNamespaceSig: signatureEncodingScheme,
          encodingUser: subspaceScheme,
          encodingUserSig: signatureEncodingScheme,
          orderSubspace: subspaceScheme.order,
          pathScheme,
        }, token.capability).byteLength;
      },
      decodeStream: async (bytes) => {
        await bytes.nextAbsolute(64);

        const signature = bytes.array.slice(0, 64);

        bytes.prune(64);

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
}

export const fingerprintScheme: Willow.FingerprintScheme<
  SharePublicKey,
  IdentityPublicKey,
  Uint8Array,
  PreFingerprint,
  Uint8Array
> = {
  neutral: ed25519.ExtendedPoint.ZERO,
  fingerprintSingleton: ({ entry, available }) => {
    const entryEnc = encodeEntry({
      encodeNamespace: namespaceScheme.encode,
      pathScheme,
      encodePayload: (digest) => digest,
      encodeSubspace: subspaceScheme.encode,
    }, entry);

    const encoded = concat([encodeCompactWidth(available), entryEnc]);

    return Promise.resolve(hashToCurve(encoded, {
      DST: "earthstar6i",
    }));
  },
  fingerprintCombine: (a, b) => {
    // We do this because willow-js doesn't (de)serialise classes with all their methods.
    const realA = new ExtendedPoint(a.ex, a.ey, a.ez, a.et);
    const realB = new ExtendedPoint(b.ex, b.ey, b.ez, b.et);
    return realA.add(realB);
  },
  fingerprintFinalise: (pre) => {
    // @ts-ignore https://github.com/paulmillr/noble-curves/issues/137
    return pre.toRawBytes();
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

export function makeAccessControlScheme(
  auth: Auth,
  ed25519: Ed25519Driver<Uint8Array>,
  blake3: Blake3Driver,
): Willow.AccessControlScheme<
  Meadowcap.ReadCapability<
    SharePublicKey,
    IdentityPublicKey,
    Uint8Array,
    Uint8Array
  >,
  IdentityPublicKey,
  Uint8Array,
  Uint8Array,
  SharePublicKey,
  IdentityPublicKey
> {
  const meadowcap = new Meadowcap.Meadowcap(
    makeMeadowcapParams(ed25519, blake3),
  );

  return {
    getGrantedArea: (cap) => meadowcap.getCapGrantedArea(cap),
    getGrantedNamespace: (cap) => cap.namespaceKey,
    getReceiver: (cap) => meadowcap.getCapReceiver(cap),
    getSecretKey: async (receiver) => {
      const keypair = await auth.identityKeypair(receiver);

      if (!keypair) {
        throw new EarthstarError(
          "Failed to retrieve a secret for a capability's receiver.",
        );
      }

      return keypair.secretKey;
    },
    isValidCap: (cap) => meadowcap.isValidCap(cap),
    signatures: {
      sign: (publicKey, secretKey, msg) => {
        return identitySign(
          {
            publicKey,
            secretKey,
          },
          msg,
          ed25519,
        );
      },
      verify: (publicKey, signature, bytestring) => {
        return identityVerify(publicKey, signature, bytestring, ed25519);
      },
    },
    encodings: {
      readCapability: {
        encode: (cap) => {
          return meadowcap.encodeCap(cap);
        },
        decode: (cap) => {
          return meadowcap.decodeCap(cap) as Meadowcap.ReadCapability<
            SharePublicKey,
            IdentityPublicKey,
            Uint8Array,
            Uint8Array
          >;
        },
        decodeStream: (cap) => {
          return meadowcap.decodeStreamingCap(cap) as Promise<
            Meadowcap.ReadCapability<
              SharePublicKey,
              IdentityPublicKey,
              Uint8Array,
              Uint8Array
            >
          >;
        },
        encodedLength: (cap) => {
          return meadowcap.encodeCap(cap).byteLength;
        },
      },
      syncSignature: {
        encode: (sig) => sig,
        decode: (sig) => sig.subarray(0, 64),
        encodedLength: () => 64,
        decodeStream: async (bytes) => {
          await bytes.nextAbsolute(64);

          const sig = bytes.array.slice(0, 64);

          bytes.prune(64);

          return sig;
        },
      },
    },
  };
}

export function makeSubspaceCapScheme(
  auth: Auth,
  ed25519: Ed25519Driver<Uint8Array>,
  blake3: Blake3Driver,
): Willow.SubspaceCapScheme<
  SubspaceCapability,
  IdentityPublicKey,
  Uint8Array,
  Uint8Array,
  SharePublicKey
> {
  const meadowcap = new Meadowcap.Meadowcap(
    makeMeadowcapParams(ed25519, blake3),
  );

  return {
    getNamespace: (cap) => cap.namespaceKey,
    getReceiver: (cap) => Meadowcap.getReceiverSubspaceCap(cap),
    isValidCap: (cap) => meadowcap.isValidSubspaceCap(cap),
    getSecretKey: async (receiver) => {
      const keypair = await auth.identityKeypair(receiver);

      if (!keypair) {
        throw new EarthstarError(
          "Failed to retrieve a secret for a capability's receiver.",
        );
      }

      return keypair.secretKey;
    },
    signatures: {
      sign: (publicKey, secretKey, msg) => {
        return identitySign(
          {
            publicKey,
            secretKey,
          },
          msg,
          ed25519,
        );
      },
      verify: (publicKey, signature, bytestring) => {
        return identityVerify(publicKey, signature, bytestring, ed25519);
      },
    },
    encodings: {
      subspaceCapability: {
        encode: (cap) => meadowcap.encodeSubspaceCap(cap),
        decode: (cap) => meadowcap.decodeSubspaceCap(cap),
        encodedLength: (cap) => meadowcap.encodeSubspaceCap(cap).byteLength,
        decodeStream: (cap) => meadowcap.decodeStreamingSubspaceCap(cap),
      },
      syncSubspaceSignature: {
        encode: (sig) => sig,
        decode: (sig) => sig.subarray(0, 64),
        encodedLength: () => 64,
        decodeStream: async (bytes) => {
          await bytes.nextAbsolute(64);

          const sig = bytes.array.slice(0, 64);

          bytes.prune(64);

          return sig;
        },
      },
    },
  };
}

export function makeAuthorisationTokenScheme(
  ed25519: Ed25519Driver<Uint8Array>,
  blake3: Blake3Driver,
): Willow.AuthorisationTokenScheme<
  AuthorisationToken,
  Meadowcap.WriteCapability<
    SharePublicKey,
    IdentityPublicKey,
    Uint8Array,
    Uint8Array
  >,
  Uint8Array
> {
  const meadowcap = new Meadowcap.Meadowcap(
    makeMeadowcapParams(ed25519, blake3),
  );

  return {
    decomposeAuthToken: (authToken) => {
      return [
        authToken.capability as Meadowcap.WriteCapability<
          SharePublicKey,
          IdentityPublicKey,
          Uint8Array,
          Uint8Array
        >,
        authToken.signature,
      ];
    },
    recomposeAuthToken: (staticToken, dynamicToken) => {
      return {
        capability: staticToken,
        signature: dynamicToken,
      };
    },
    encodings: {
      staticToken: {
        encode: (cap) => {
          return meadowcap.encodeCap(cap);
        },
        decode: (cap) => {
          return meadowcap.decodeCap(cap) as Meadowcap.WriteCapability<
            SharePublicKey,
            IdentityPublicKey,
            Uint8Array,
            Uint8Array
          >;
        },
        decodeStream: (cap) => {
          return meadowcap.decodeStreamingCap(cap) as Promise<
            Meadowcap.WriteCapability<
              SharePublicKey,
              IdentityPublicKey,
              Uint8Array,
              Uint8Array
            >
          >;
        },
        encodedLength: (cap) => {
          return meadowcap.encodeCap(cap).byteLength;
        },
      },
      dynamicToken: {
        encode: (sig) => sig,
        decode: (sig) => sig.subarray(0, 64),
        encodedLength: () => 64,
        decodeStream: async (bytes) => {
          await bytes.nextAbsolute(64);

          const sig = bytes.array.slice(0, 64);

          bytes.prune(64);

          return sig;
        },
      },
    },
  };
}

export function makePaiScheme(
  ed25519: Ed25519Driver<Uint8Array>,
  blake3: Blake3Driver,
): Willow.PaiScheme<
  Meadowcap.ReadCapability<
    SharePublicKey,
    IdentityPublicKey,
    Uint8Array,
    Uint8Array
  >,
  Uint8Array,
  Uint8Array,
  SharePublicKey,
  IdentityPublicKey
> {
  const meadowcap = new Meadowcap.Meadowcap(
    makeMeadowcapParams(ed25519, blake3),
  );

  return {
    isGroupEqual: (a, b) => {
      return equalsBytes(a, b);
    },
    getScalar: () => {
      return crypto.getRandomValues(new Uint8Array(32));
    },
    scalarMult(group, scalar) {
      return x25519.scalarMult(scalar, group);
    },
    getFragmentKit: (cap) => {
      const grantedArea = meadowcap.getCapGrantedArea(cap);

      if (grantedArea.includedSubspaceId === ANY_SUBSPACE) {
        return {
          grantedNamespace: cap.namespaceKey,
          grantedPath: grantedArea.pathPrefix,
        };
      }

      return {
        grantedNamespace: cap.namespaceKey,
        grantedSubspace: grantedArea.includedSubspaceId,
        grantedPath: grantedArea.pathPrefix,
      };
    },
    fragmentToGroup: (fragment) => {
      if (fragment.length === 3) {
        const [namespace, subspace, path] = fragment;

        const encoded = concat(
          [
            namespaceScheme.encode(namespace),
            subspaceScheme.encode(subspace),
            encodePath(pathScheme, path),
          ],
        );

        const curve = hashToCurve(encoded, {
          DST: "earthstar6i",
        });

        // @ts-ignore toRawBytes really _does_ exist. https://github.com/paulmillr/noble-curves/issues/137
        return curve.toRawBytes();
      }

      const [namespace, path] = fragment;

      const encoded = concat(
        [namespaceScheme.encode(namespace), encodePath(pathScheme, path)],
      );

      const curve = hashToCurve(encoded, {
        DST: "earthstar6i",
      });

      // @ts-ignore toRawBytes really _does_ exist. https://github.com/paulmillr/noble-curves/issues/137
      return curve.toRawBytes();
    },
    groupMemberEncoding: {
      encode: (group) => group,
      decode: (group) => group.subarray(0, 32),
      encodedLength: () => 32,
      decodeStream: async (bytes) => {
        await bytes.nextAbsolute(32);

        const group = bytes.array.slice(0, 32);

        bytes.prune(32);

        return group;
      },
    },
  };
}
