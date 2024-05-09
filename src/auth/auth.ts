import { deferred } from "https://deno.land/std@0.202.0/async/deferred.ts";
import {
  Area,
  compactWidth,
  concat,
  decodeCompactWidth,
  encodeCompactWidth,
  Entry,
  entryPosition,
  isIncludedArea,
  Meadowcap,
  orderBytes,
} from "../../deps.ts";
import { Blake3Digest } from "../blake3/types.ts";
import {
  decodeIdentityPublicKey,
  encodeIdentityPublicKey,
  generateIdentityKeypair,
  IdentityKeypair,
  IdentityPublicKey,
} from "../identifiers/identity.ts";
import {
  decodeSharePublicKey,
  encodeSharePublicKey,
  encodeShareTag,
  generateShareKeypair,
  isCommunalShare,
  ShareKeypair,
  SharePublicKey,
} from "../identifiers/share.ts";
import {
  meadowcapParams,
  namespaceScheme,
  subspaceScheme,
} from "../schemes/schemes.ts";
import {
  decodeBase64,
  encodeBase64,
} from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { AuthorisationError, isErr, ValidationError } from "../util/errors.ts";
import { blake3 } from "../blake3/blake3.ts";
import { Path } from "../store/types.ts";
import { earthstarToWillowPath } from "../util/path.ts";

export const meadowcap = new Meadowcap.Meadowcap(meadowcapParams);

/** An unforgeable token bestowing access to some resource. */
export type Capability = Meadowcap.McCapability<
  SharePublicKey,
  IdentityPublicKey,
  Uint8Array,
  Uint8Array
>;

function isCommunalReadCapability(
  cap:
    | Meadowcap.CommunalCapability<
      SharePublicKey,
      IdentityPublicKey,
      Uint8Array
    >
      & { accessMode: "read" }
    | Meadowcap.CommunalCapability<
      SharePublicKey,
      IdentityPublicKey,
      Uint8Array
    >
      & { accessMode: "write" },
): cap is Meadowcap.CommunalReadCapability<
  SharePublicKey,
  IdentityPublicKey,
  Uint8Array
> {
  return cap.accessMode === "read";
}

function isOwnedReadCapability(
  cap:
    | Meadowcap.OwnedCapability<
      SharePublicKey,
      IdentityPublicKey,
      Uint8Array,
      Uint8Array
    >
      & { accessMode: "read" }
    | Meadowcap.OwnedCapability<
      SharePublicKey,
      IdentityPublicKey,
      Uint8Array,
      Uint8Array
    >
      & { accessMode: "write" },
): cap is Meadowcap.OwnedReadCapability<
  SharePublicKey,
  IdentityPublicKey,
  Uint8Array,
  Uint8Array
> {
  return cap.accessMode === "read";
}

/** An unforgeable token proving that the holder of an identity keypair is authorised to know about arbitrary identities in an owned share. */
export type SubspaceCapability = Meadowcap.McSubspaceCapability<
  SharePublicKey,
  IdentityPublicKey,
  Uint8Array,
  Uint8Array
>;

export type ReadCapPack = {
  readCap: Meadowcap.ReadCapability<
    SharePublicKey,
    IdentityPublicKey,
    Uint8Array,
    Uint8Array
  >;
  subspaceCap?: Meadowcap.McSubspaceCapability<
    SharePublicKey,
    IdentityPublicKey,
    Uint8Array,
    Uint8Array
  >;
};
export type WriteCapPack = {
  writeCap: Meadowcap.WriteCapability<
    SharePublicKey,
    IdentityPublicKey,
    Uint8Array,
    Uint8Array
  >;
};

function isReadCapPack(
  capPack: ReadCapPack | WriteCapPack,
): capPack is ReadCapPack {
  return "readCap" in capPack;
}

export type AuthorisationToken = Meadowcap.MeadowcapAuthorisationToken<
  SharePublicKey,
  IdentityPublicKey,
  Uint8Array,
  Uint8Array
>;

const PASSWORD_CHALLENGE = new Uint8Array([2, 3, 5, 8, 13]);

/** Stores sensitive credentials like share and identity keypairs and capabilities in local storage. Encrypts and decrypts contents using a plaintext password. */
export class Auth {
  private cryptoKey = deferred<CryptoKey>();

  /** Wipes all keypairs and capabilities from local storage. */
  static reset() {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("earthstar_auth")) {
        continue;
      }

      localStorage.removeItem(key);
    }
  }

  /** Check if Auth has been successfully initialised with the given password. */
  async ready(): Promise<boolean> {
    await this.cryptoKey;

    return true;
  }

  constructor(password: string) {
    crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"],
    ).then(async (key) => {
      const existingPassword = localStorage.getItem("earthstar_auth_pwd_test");

      if (!existingPassword) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));

        const encryptionKey = await crypto.subtle.deriveKey(
          {
            name: "PBKDF2",
            salt,
            iterations: 250000,
            hash: "SHA-256",
          },
          key,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt"],
        );

        const encrypted = await crypto.subtle.encrypt(
          {
            name: "AES-GCM",
            iv,
          },
          encryptionKey,
          PASSWORD_CHALLENGE,
        );

        const encryptedTest = concat(salt, iv, new Uint8Array(encrypted));

        const b64Encrypted = encodeBase64(encryptedTest);
        localStorage.setItem("earthstar_auth_pwd_test", b64Encrypted);
        this.cryptoKey.resolve(key);

        return;
      }

      const encryptedTest = decodeBase64(existingPassword);

      const salt = encryptedTest.subarray(0, 16);
      const iv = encryptedTest.subarray(16, 16 + 12);
      const encryptedData = encryptedTest.subarray(16 + 12);

      try {
        const decryptionKey = await crypto.subtle.deriveKey(
          {
            name: "PBKDF2",
            salt,
            iterations: 250000,
            hash: "SHA-256",
          },
          key,
          { name: "AES-GCM", length: 256 },
          false,
          ["decrypt"],
        );

        const decrypted = await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv,
          },
          decryptionKey,
          encryptedData,
        );

        if (orderBytes(new Uint8Array(decrypted), PASSWORD_CHALLENGE) !== 0) {
          throw new Error();
        }

        // It's the right password, yay.
        this.cryptoKey.resolve(key);
      } catch {
        this.cryptoKey.reject("Wrong password entered for Auth");
      }
    });
  }

  private async encrypt(bytes: Uint8Array) {
    const key = await this.cryptoKey;

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encryptionKey = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: 250000,
        hash: "SHA-256",
      },
      key,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"],
    );

    const encrypted = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
      },
      encryptionKey,
      bytes,
    );

    return concat(salt, iv, new Uint8Array(encrypted));
  }

  private async decrypt(encrypted: Uint8Array): Promise<Uint8Array> {
    const salt = encrypted.subarray(0, 16);
    const iv = encrypted.subarray(16, 16 + 12);
    const encryptedData = encrypted.subarray(16 + 12);

    const key = await this.cryptoKey;

    const decryptionKey = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: 250000,
        hash: "SHA-256",
      },
      key,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );

    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
      },
      decryptionKey,
      encryptedData,
    );

    return new Uint8Array(decrypted);
  }

  private async set(keyPrefix: string, bytes: Uint8Array): Promise<string> {
    const digest = await blake3(bytes);
    const b64Digest = encodeBase64(digest);
    const b64Bytes = encodeBase64(bytes);

    const key = `earthstar_auth_${keyPrefix}_${b64Digest}`;

    localStorage.setItem(key, b64Bytes);

    return key;
  }

  private rehydrate(b64: string): Promise<Uint8Array> {
    const bytes = decodeBase64(b64);

    return this.decrypt(bytes);
  }

  /** Create a new identity keypair and safely store it. */
  async createIdentityKeypair(
    shortname: string,
  ): Promise<IdentityKeypair | ValidationError> {
    const keypair = await generateIdentityKeypair(shortname);

    if (isErr(keypair)) {
      return keypair;
    }

    await this.addIdentityKeypair(keypair);

    return keypair;
  }

  /** Safely store an existing identity keypair. */
  async addIdentityKeypair(keypair: IdentityKeypair): Promise<void> {
    const keypairEncoded = encodeIdentityKeypair(keypair);
    const keypairEncrypted = await this.encrypt(keypairEncoded);

    await this.set("identitykeypair", keypairEncrypted);
  }

  /** Iterate through all identity keypairs in encrypted storage. */
  async *identityKeypairs() {
    for (const [key, value] of Object.entries(localStorage)) {
      if (!isEarthstarAuthPrefixed("identitykeypair", key)) {
        continue;
      }

      const keypairBytes = await this.rehydrate(value);

      yield decodeIdentityKeypair(keypairBytes);
    }
  }

  /** Create a new share keypair and safely store it. */
  async createShareKeypair(
    name: string,
    owned: boolean,
  ): Promise<ShareKeypair | ValidationError> {
    const keypair = await generateShareKeypair(name, owned);

    if (isErr(keypair)) {
      return keypair;
    }

    await this.addShareKeypair(keypair);

    return keypair;
  }

  /** Safely store an existing identity keypair. */
  async addShareKeypair(keypair: IdentityKeypair): Promise<void> {
    const keypairEncoded = encodeShareKeypair(keypair);
    const keypairEncrypted = await this.encrypt(keypairEncoded);

    await this.set("sharekeypair", keypairEncrypted);
  }

  /** Iterate through all share keypairs in encrypted storage. */
  async *shareKeypairs() {
    for (const [key, value] of Object.entries(localStorage)) {
      if (!isEarthstarAuthPrefixed("sharekeypair", key)) {
        continue;
      }

      const keypairBytes = await this.rehydrate(value);

      yield decodeShareKeypair(keypairBytes);
    }
  }

  /** Retrieve the identity keypair for a given share public key. */
  async shareKeypair(share: SharePublicKey): Promise<ShareKeypair | undefined> {
    for await (const keypair of this.shareKeypairs()) {
      if (!namespaceScheme.isEqual(share, keypair.publicKey)) {
        continue;
      }

      return keypair;
    }

    return undefined;
  }

  /** Produce a new cap pack granting full read / write access based on the semantics of the share (communal vs. share), and optionally store it in encrypted storage. */
  async createFullCapPack(
    share: SharePublicKey,
    forUser: IdentityPublicKey,
    accessMode: "read",
    store?: boolean,
  ): Promise<ReadCapPack | ValidationError>;
  async createFullCapPack(
    share: SharePublicKey,
    forUser: IdentityPublicKey,
    accessMode: "write",
    store?: boolean,
  ): Promise<WriteCapPack | ValidationError>;
  async createFullCapPack(
    share: SharePublicKey,
    forUser: IdentityPublicKey,
    accessMode: Meadowcap.AccessMode,
    store = true,
  ): Promise<ReadCapPack | WriteCapPack | ValidationError> {
    const keypair = await this.shareKeypair(share);

    if (!keypair) {
      return new ValidationError(
        "Do not have the keypair for a share of that public key.",
      );
    }

    if (isCommunalShare(keypair.publicKey)) {
      const cap = meadowcap.createCapCommunal({
        accessMode: accessMode,
        namespace: share,
        user: forUser,
      });

      if (store) {
        const encoded = isCommunalReadCapability(cap)
          ? encodeReadCapPack({ readCap: cap })
          : meadowcap.encodeCap(cap);
        const encrypted = await this.encrypt(encoded);
        await this.set(accessMode, encrypted);
      }

      return isCommunalReadCapability(cap)
        ? { readCap: cap }
        : { writeCap: cap };
    }

    const cap = await meadowcap.createCapOwned({
      accessMode: accessMode,
      namespace: share,
      namespaceSecret: keypair.secretKey,
      user: forUser,
    });

    if (isOwnedReadCapability(cap)) {
      const subspaceCap = await meadowcap.createSubspaceCap(
        share,
        keypair.secretKey,
        forUser,
      );

      const capPack = {
        readCap: cap,
        subspaceCap: subspaceCap,
      };

      if (store) {
        const encoded = encodeReadCapPack(capPack);
        const encrypted = await this.encrypt(encoded);
        await this.set(accessMode, encrypted);
      }

      return capPack;
    }

    if (store) {
      const encoded = meadowcap.encodeCap(cap);
      const encrypted = await this.encrypt(encoded);
      await this.set(accessMode, encrypted);
    }

    return { writeCap: cap };
  }

  /** Delegate an existing cap pack to a new user. Does not add to storage by default. */
  async delegateCapPack(
    { capPack, userSecret, toUser, restrictTo }: {
      capPack: ReadCapPack;
      userSecret: Uint8Array;
      toUser: IdentityPublicKey;
      restrictTo: {
        identity?: IdentityPublicKey;
        pathPrefix?: Path;
        time?: {
          start: bigint;
          end: bigint;
        };
      };
    },
  ): Promise<ReadCapPack | ValidationError>;
  async delegateCapPack(
    { capPack, userSecret, toUser, restrictTo }: {
      capPack: WriteCapPack;
      userSecret: Uint8Array;
      toUser: IdentityPublicKey;
      restrictTo: {
        identity?: IdentityPublicKey;
        pathPrefix?: Path;
        time?: {
          start: bigint;
          end: bigint;
        };
      };
    },
  ): Promise<WriteCapPack | ValidationError>;
  async delegateCapPack(
    { capPack, userSecret, toUser, restrictTo }: {
      /** The cap pack to delegate */
      capPack: ReadCapPack | WriteCapPack;
      /** The secret of this cap pack's **receiver**. */
      userSecret: Uint8Array;
      /** The public key of the user to delegate to. */
      toUser: IdentityPublicKey;
      /** Further restrictions to put on the newly delegated cap pack. */
      restrictTo: {
        /** An identity to constrain the granted area to. */
        identity?: IdentityPublicKey;
        /** A path prefix to constrain the granted area to. */
        pathPrefix?: Path;
        /** A time range to constrain the granted area to. */
        time?: {
          start: bigint;
          end: bigint;
        };
      };
    },
  ): Promise<ReadCapPack | WriteCapPack | ValidationError> {
    const restrictToPath = restrictTo.pathPrefix
      ? earthstarToWillowPath(restrictTo.pathPrefix)
      : undefined;

    if (isErr(restrictToPath)) {
      return new ValidationError("Tried to restrict to an invalid path");
    }

    if (
      !isReadCapPack(capPack)
    ) {
      const grantedArea = meadowcap.getCapGrantedArea(capPack.writeCap);

      const toArea: Area<IdentityPublicKey> = {
        includedSubspaceId: restrictTo.identity ||
          grantedArea.includedSubspaceId,
        pathPrefix: restrictToPath ||
          grantedArea.pathPrefix,
        timeRange: restrictTo.time || grantedArea.timeRange,
      };

      try {
        if (meadowcap.isCommunal(capPack.writeCap)) {
          const cap = await meadowcap.delegateCapCommunal(
            {
              cap: capPack.writeCap,
              secret: userSecret,
              user: toUser,
              area: toArea,
            },
          );

          return { writeCap: cap };
        }

        const cap = await meadowcap.delegateCapOwned(
          {
            cap: capPack.writeCap,
            secret: userSecret,
            user: toUser,
            area: toArea,
          },
        );

        return { writeCap: cap };
      } catch (err) {
        return new ValidationError(err);
      }
    }

    const grantedArea = meadowcap.getCapGrantedArea(capPack.readCap);

    const toArea: Area<IdentityPublicKey> = {
      includedSubspaceId: restrictTo.identity ||
        grantedArea.includedSubspaceId,
      pathPrefix: restrictToPath ||
        grantedArea.pathPrefix,
      timeRange: restrictTo.time || grantedArea.timeRange,
    };

    if (capPack.subspaceCap === undefined) {
      if (meadowcap.isCommunal(capPack.readCap)) {
        const delegated = await meadowcap.delegateCapCommunal(
          {
            cap: capPack.readCap,
            secret: userSecret,
            user: toUser,
            area: toArea,
          },
        );

        return { readCap: delegated };
      }

      const delegated = await meadowcap.delegateCapOwned(
        {
          cap: capPack.readCap,
          secret: userSecret,
          user: toUser,
          area: toArea,
        },
      );

      if (meadowcap.needsSubspaceCap(delegated)) {
        return new ValidationError(
          "Newly delegated cap needs a subspace capability, but was not provided an existing subspace capability to delegate from.",
        );
      }

      return { readCap: delegated };
    }

    if (meadowcap.isCommunal(capPack.readCap)) {
      return new ValidationError(
        "Was provided a communal read capability alongside a subspace capability. Why?",
      );
    }

    const delegatedCap = await meadowcap.delegateCapOwned(
      {
        cap: capPack.readCap,
        secret: userSecret,
        user: toUser,
        area: toArea,
      },
    );

    const delegatedSubspaceCap = await meadowcap.delegateSubspaceCap(
      capPack.subspaceCap,
      toUser,
      userSecret,
    );

    return {
      readCap: delegatedCap,
      subspaceCap: delegatedSubspaceCap,
    };
  }

  /** Safely store an existing cap pack.
   *
   * Will return an error if no corresponding keypair for the cap pack's receiver is held in safe storage. */
  async addCapPack(
    capPack: ReadCapPack | WriteCapPack,
  ): Promise<true | AuthorisationError> {
    const cap = "readCap" in capPack ? capPack.readCap : capPack.writeCap;

    const receiver = meadowcap.getCapReceiver(cap);

    for await (const keypair of this.identityKeypairs()) {
      if (subspaceScheme.order(keypair.publicKey, receiver) === 0) {
        const encoded = "readCap" in capPack
          ? encodeReadCapPack(capPack)
          : meadowcap.encodeCap(capPack.writeCap);
        const encrypted = await this.encrypt(encoded);

        await this.set(cap.accessMode, encrypted);

        return true;
      }
    }

    return new AuthorisationError(
      "No corresponding keypair held for the given cap pack.",
    );
  }

  /** Iterate through read access cap packs in safe storage. */
  async *readCapPacks(
    /** An optional share public key to filter by. */
    share?: SharePublicKey,
    /** Filter by cap packs which include this optional entry. */
    entry?: Entry<SharePublicKey, IdentityPublicKey, Blake3Digest>,
  ): AsyncIterable<ReadCapPack> {
    // Find keypairs
    for (const [key, value] of Object.entries(localStorage)) {
      if (!isEarthstarAuthPrefixed("read", key)) {
        continue;
      }

      const capBytes = await this.rehydrate(value);

      const capPack = decodeReadCapPack(capBytes);

      if (!share) {
        yield capPack;
        continue;
      }

      const grantedNamespace = Meadowcap.getGrantedNamespace(
        capPack.readCap,
      );

      if (!namespaceScheme.isEqual(share, grantedNamespace)) {
        continue;
      }

      if (!entry) {
        yield capPack;
        continue;
      }

      const grantedArea = meadowcap.getCapGrantedArea(capPack.readCap);

      const isIncluded = isIncludedArea(
        subspaceScheme.order,
        grantedArea,
        entryPosition(entry),
      );

      if (!isIncluded) {
        continue;
      }

      yield capPack;
    }
  }

  /** Iterate through write access cap packs in safe storage. */
  async *writeCapPacks(
    /** An optional share public key to filter by. */
    share?: SharePublicKey,
    /** Filter by cap packs which include this optional entry. */
    entry?: Entry<SharePublicKey, IdentityPublicKey, Blake3Digest>,
  ): AsyncIterable<WriteCapPack> {
    // Find keypairs
    for (const [key, value] of Object.entries(localStorage)) {
      if (!isEarthstarAuthPrefixed("write", key)) {
        continue;
      }

      const capBytes = await this.rehydrate(value);

      const cap = meadowcap.decodeCap(capBytes);

      if (!share) {
        yield { writeCap: cap } as WriteCapPack;
        continue;
      }

      const grantedNamespace = Meadowcap.getGrantedNamespace(cap);

      if (!namespaceScheme.isEqual(share, grantedNamespace)) {
        continue;
      }

      if (!entry) {
        yield { writeCap: cap } as WriteCapPack;
        continue;
      }

      const grantedArea = meadowcap.getCapGrantedArea(cap);

      const isIncluded = isIncludedArea(
        subspaceScheme.order,
        grantedArea,
        entryPosition(entry),
      );

      if (!isIncluded) {
        continue;
      }

      yield { writeCap: cap } as WriteCapPack;
    }
  }

  /** Determine whether a cap pack is valid or not. */
  async isValidCapPack(
    capPack: WriteCapPack | ReadCapPack,
  ): Promise<boolean> {
    if (
      "subspaceCap" in capPack && capPack.subspaceCap &&
      await meadowcap.isValidSubspaceCap(capPack.subspaceCap) ===
        false
    ) {
      return false;
    }

    const cap = "readCap" in capPack ? capPack.readCap : capPack.writeCap;

    return meadowcap.isValidCap(cap);
  }

  /** Return an array of all share public keys authorised by cap packs in safe storage. */
  async allAuthorisedShares(): Promise<SharePublicKey[]> {
    const sharePublicKeys: SharePublicKey[] = [];

    const foundShares = new Set<string>();

    await Promise.all(
      [
        async () => {
          for await (const writeCapPack of this.writeCapPacks()) {
            const tag = encodeShareTag(writeCapPack.writeCap.namespaceKey);

            if (foundShares.has(tag)) {
              continue;
            }

            foundShares.add(tag);
            sharePublicKeys.push(writeCapPack.writeCap.namespaceKey);
          }
        },
        async () => {
          for await (const readCapPacks of this.readCapPacks()) {
            const tag = encodeShareTag(readCapPacks.readCap.namespaceKey);

            if (foundShares.has(tag)) {
              continue;
            }

            foundShares.add(tag);
            sharePublicKeys.push(readCapPacks.readCap.namespaceKey);
          }
        },
      ],
    );

    return sharePublicKeys;
  }
}

function encodeIdentityKeypair(keypair: IdentityKeypair): Uint8Array {
  const publicKeyEncoded = encodeIdentityPublicKey(keypair.publicKey);
  return concat(publicKeyEncoded, keypair.secretKey);
}

function decodeIdentityKeypair(encoded: Uint8Array): IdentityKeypair {
  const publicKeyEncoded = encoded.subarray(0, 36);

  const publicKey = decodeIdentityPublicKey(publicKeyEncoded);

  return {
    publicKey,
    secretKey: encoded.slice(36),
  };
}

function encodeShareKeypair(keypair: ShareKeypair): Uint8Array {
  const publicKeyEncoded = encodeSharePublicKey(keypair.publicKey);

  return concat(publicKeyEncoded, keypair.secretKey);
}

function decodeShareKeypair(encoded: Uint8Array): IdentityKeypair {
  const publicKey = decodeSharePublicKey(encoded);
  const len = encodeSharePublicKey(publicKey).length;

  return {
    publicKey,
    secretKey: encoded.slice(len),
  };
}

function encodeReadCapPack(capPack: ReadCapPack): Uint8Array {
  const encodedCap = meadowcap.encodeCap(capPack.readCap);

  if (capPack.subspaceCap === undefined) {
    return concat(new Uint8Array([0]), encodedCap);
  }

  const encodedSubspaceCap = meadowcap.encodeSubspaceCap(
    capPack.subspaceCap,
  );

  const capCompactWidth = compactWidth(encodedCap.length);
  const capLen = encodeCompactWidth(encodedCap.length);

  return concat(
    new Uint8Array([capCompactWidth]),
    capLen,
    encodedCap,
    encodedSubspaceCap,
  );
}

function decodeReadCapPack(encoded: Uint8Array): ReadCapPack {
  const [lengthCompactWidth] = encoded;

  if (lengthCompactWidth === 0) {
    return {
      readCap: meadowcap.decodeCap(encoded.subarray(1)),
    } as ReadCapPack;
  }

  const length = Number(
    decodeCompactWidth(encoded.subarray(1, 1 + lengthCompactWidth)),
  );

  const cap = meadowcap.decodeCap(encoded.subarray(1 + lengthCompactWidth));

  const subspaceCap = meadowcap.decodeSubspaceCap(
    encoded.subarray(1 + lengthCompactWidth + length),
  );

  return {
    readCap: cap,
    subspaceCap: subspaceCap,
  } as ReadCapPack;
}

function isEarthstarAuthPrefixed(prefix: string, key: string) {
  return key.startsWith(`earthstar_auth_${prefix}`);
}
