import {
  Area,
  areaIsIncluded,
  concat,
  deferred,
  Meadowcap,
  orderBytes,
  Willow,
} from "../../deps.ts";
import {
  decodeIdentityPublicKey,
  encodeIdentityPublicKey,
  generateIdentityKeypair,
  IdentityKeypairRaw,
  IdentityPublicKey,
  identitySign,
  identityVerify,
} from "../identifiers/identity.ts";
import {
  decodeSharePublicKey,
  encodeSharePublicKey,
  encodeShareTag,
  generateShareKeypair,
  isCommunalShare,
  ShareKeypairRaw,
  SharePublicKey,
  shareSign,
  ShareTag,
  shareVerify,
} from "../identifiers/share.ts";
import {
  meadowcapParams,
  namespaceScheme,
  subspaceScheme,
} from "../schemes/schemes.ts";
import {
  AuthorisationError,
  EarthstarError,
  isErr,
  ValidationError,
} from "../util/errors.ts";
import { blake3 } from "../blake3/blake3.ts";
import { Capability, ReadCapPack, WriteCapPack } from "../caps/types.ts";
import {
  decodeCapPack,
  encodeCapPack,
  isCommunalReadCapability,
  isOwnedReadCapability,
  isReadCapPack,
} from "../caps/util.ts";
import { SyncInterests } from "../syncer/syncer.ts";
import { CapPackSelector } from "./types.ts";
import { Path } from "../path/path.ts";

const meadowcap = new Meadowcap.Meadowcap(meadowcapParams);

export type AuthorisationToken = Meadowcap.MeadowcapAuthorisationToken<
  SharePublicKey,
  IdentityPublicKey,
  Uint8Array,
  Uint8Array
>;

const PASSWORD_CHALLENGE = new Uint8Array([2, 3, 5, 8, 13]);

export type AuthOpts = {
  password: string;
  kvDriver: Willow.KvDriver;
};

/** Stores sensitive credentials like share and identity keypairs and capabilities in local storage. Encrypts and decrypts contents using a plaintext password. */
export class Auth {
  private encryptionKey = deferred<CryptoKey>();
  private kvDriver: Willow.KvDriver;

  /** Wipes all keypairs and capabilities from local storage. */
  static reset(kvDriver: Willow.KvDriver): Promise<void> {
    return kvDriver.clear();
  }

  /** Check if Auth has been successfully initialised with the given password. */
  async ready(): Promise<boolean> {
    await this.encryptionKey;

    return true;
  }

  constructor(opts: AuthOpts) {
    this.kvDriver = opts.kvDriver;

    crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(opts.password),
      "PBKDF2",
      false,
      ["deriveKey"],
    ).then(async (key) => {
      const encryptedChallenge = await opts.kvDriver.get<Uint8Array>([
        "pwd_challenge",
      ]);

      if (!encryptedChallenge) {
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
          ["encrypt", "decrypt"],
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

        this.kvDriver.set(["pwd_challenge"], encryptedTest);

        this.encryptionKey.resolve(encryptionKey);

        return;
      }

      const salt = encryptedChallenge.subarray(0, 16);
      const iv = encryptedChallenge.subarray(16, 16 + 12);
      const encryptedData = encryptedChallenge.subarray(16 + 12);

      try {
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
          ["encrypt", "decrypt"],
        );

        const decrypted = await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv,
          },
          encryptionKey,
          encryptedData,
        );

        if (orderBytes(new Uint8Array(decrypted), PASSWORD_CHALLENGE) !== 0) {
          throw new Error();
        }

        // It's the right password, yay.
        this.encryptionKey.resolve(encryptionKey);
      } catch {
        this.encryptionKey.reject("Wrong password entered for Auth");
      }
    });
  }

  private async encrypt(bytes: Uint8Array) {
    const key = await this.encryptionKey;

    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encrypted = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
      },
      key,
      bytes,
    );

    return concat(iv, new Uint8Array(encrypted));
  }

  private async decrypt(encrypted: Uint8Array): Promise<Uint8Array> {
    const iv = encrypted.subarray(0, 12);
    const encryptedData = encrypted.subarray(12);

    const key = await this.encryptionKey;

    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
      },
      key,
      encryptedData,
    );

    return new Uint8Array(decrypted);
  }

  private async checkIdentityKeypairIsValid(
    keypair: IdentityKeypairRaw,
  ): Promise<true | ValidationError> {
    const message = crypto.getRandomValues(new Uint8Array(16));
    const sig = await identitySign(keypair, message);
    const isValid = await identityVerify(keypair.publicKey, sig, message);

    if (!isValid) {
      return new ValidationError("Identity secret does not match public key");
    }

    return true;
  }

  private async checkShareKeypairIsValid(
    keypair: ShareKeypairRaw,
  ): Promise<true | ValidationError> {
    const message = crypto.getRandomValues(new Uint8Array(16));
    const sig = await shareSign(keypair, message);
    const isValid = await shareVerify(keypair.publicKey, sig, message);

    if (!isValid) {
      return new ValidationError("Identity secret does not match public key");
    }

    return true;
  }

  /** Create a new identity keypair and safely store it. */
  async createIdentityKeypair(
    shortname: string,
  ): Promise<IdentityKeypairRaw | ValidationError> {
    const keypair = await generateIdentityKeypair(shortname);

    if (isErr(keypair)) {
      return keypair;
    }

    await this.addIdentityKeypair(keypair);

    return keypair;
  }

  /** Safely store an existing identity keypair. */
  async addIdentityKeypair(
    keypair: IdentityKeypairRaw,
  ): Promise<true | ValidationError> {
    const isValid = await this.checkIdentityKeypairIsValid(keypair);

    if (isErr(isValid)) {
      return isValid;
    }

    const keypairEncoded = encodeIdentityKeypair(keypair);
    const keypairEncrypted = await this.encrypt(keypairEncoded);

    await this.kvDriver.set(
      ["keypair", "identity", crypto.getRandomValues(new Uint8Array(32))],
      keypairEncrypted,
    );

    return true;
  }

  /** Iterate through all identity keypairs in encrypted storage. */
  async *identityKeypairs(): AsyncIterable<IdentityKeypairRaw> {
    for await (
      const { value } of this.kvDriver.list<Uint8Array>({
        prefix: ["keypair", "identity"],
      })
    ) {
      const decrypted = await this.decrypt(value);
      yield decodeIdentityKeypair(decrypted);
    }
  }

  /** Retrieve the identity keypair for a given share public key. */
  async identityKeypair(
    identity: IdentityPublicKey,
  ): Promise<IdentityKeypairRaw | undefined> {
    for await (
      const { value } of this.kvDriver.list<Uint8Array>({
        prefix: ["keypair", "identity"],
      })
    ) {
      const decrypted = await this.decrypt(value);
      const keypair = decodeIdentityKeypair(decrypted);

      if (subspaceScheme.order(keypair.publicKey, identity) === 0) {
        return keypair;
      }
    }
  }

  /** Create a new share keypair and safely store it. */
  async createShareKeypair(
    name: string,
    owned: boolean,
  ): Promise<ShareKeypairRaw | ValidationError> {
    const keypair = await generateShareKeypair(name, owned);

    if (isErr(keypair)) {
      return keypair;
    }

    const res = await this.addShareKeypair(keypair);

    if (isErr(res)) {
      throw res;
    }

    return keypair;
  }

  /** Safely store an existing identity keypair.
   *
   * Keypairs for shares with communal public keys are not validated, as the secret is never used.
   */
  async addShareKeypair(
    keypair: IdentityKeypairRaw,
  ): Promise<true | ValidationError> {
    if (!isCommunalShare(keypair.publicKey)) {
      const isValid = await this.checkShareKeypairIsValid(keypair);

      if (isErr(isValid)) {
        return isValid;
      }
    }

    const keypairEncoded = encodeShareKeypair(keypair);
    const keypairEncrypted = await this.encrypt(keypairEncoded);

    await this.kvDriver.set(
      ["keypair", "share", crypto.getRandomValues(new Uint8Array(32))],
      keypairEncrypted,
    );

    return true;
  }

  /** Iterate through all share keypairs in encrypted storage. */
  async *shareKeypairs(): AsyncIterable<ShareKeypairRaw> {
    for await (
      const { value } of this.kvDriver.list<Uint8Array>({
        prefix: ["keypair", "share"],
      })
    ) {
      const decrypted = await this.decrypt(value);
      yield decodeShareKeypair(decrypted);
    }
  }

  /** Retrieve the identity keypair for a given share public key. */
  async shareKeypair(
    share: SharePublicKey,
  ): Promise<ShareKeypairRaw | undefined> {
    for await (
      const { value } of this.kvDriver.list<Uint8Array>({
        prefix: ["keypair", "share"],
      })
    ) {
      const decrypted = await this.decrypt(value);
      const keypair = decodeShareKeypair(decrypted);

      if (namespaceScheme.isEqual(keypair.publicKey, share)) {
        return keypair;
      }
    }
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
        await this.addCapPack(
          isCommunalReadCapability(cap) ? { readCap: cap } : { writeCap: cap },
        );
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
        await this.addCapPack(capPack);
      }

      return capPack;
    }

    if (store) {
      await this.addCapPack({ writeCap: cap });
    }

    return { writeCap: cap };
  }

  /** Delegate an existing cap pack to a new user. Does not add to storage by default. */
  async delegateCapPack(
    { capPack, toUser, restrictTo }: {
      capPack: ReadCapPack;
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
    { capPack, toUser, restrictTo }: {
      capPack: WriteCapPack;
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
    { capPack, toUser, restrictTo }: {
      /** The cap pack to delegate */
      capPack: ReadCapPack | WriteCapPack;
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
      ? restrictTo.pathPrefix
      : undefined;

    if (isErr(restrictToPath)) {
      return new ValidationError("Tried to restrict to an invalid path");
    }

    if (
      !isReadCapPack(capPack)
    ) {
      const receiverKeypair = await this.identityKeypair(
        meadowcap.getCapReceiver(capPack.writeCap),
      );

      if (!receiverKeypair) {
        return new ValidationError(
          "Do not have the necessary credentials to delegate this capability.",
        );
      }

      const grantedArea = meadowcap.getCapGrantedArea(capPack.writeCap);

      const toArea: Area<IdentityPublicKey> = {
        includedSubspaceId: restrictTo.identity ||
          grantedArea.includedSubspaceId,
        pathPrefix: restrictToPath?.underlying ||
          grantedArea.pathPrefix,
        timeRange: restrictTo.time || grantedArea.timeRange,
      };

      try {
        if (meadowcap.isCommunal(capPack.writeCap)) {
          const cap = await meadowcap.delegateCapCommunal(
            {
              cap: capPack.writeCap,
              secret: receiverKeypair.secretKey,
              user: toUser,
              area: toArea,
            },
          );

          return { writeCap: cap };
        }

        const cap = await meadowcap.delegateCapOwned(
          {
            cap: capPack.writeCap,
            secret: receiverKeypair.secretKey,
            user: toUser,
            area: toArea,
          },
        );

        return { writeCap: cap };
      } catch (err) {
        return new ValidationError(err);
      }
    }

    const receiverKeypair = await this.identityKeypair(
      meadowcap.getCapReceiver(capPack.readCap),
    );

    if (!receiverKeypair) {
      return new ValidationError(
        "Do not have the necessary credentials to delegate this capability.",
      );
    }

    const grantedArea = meadowcap.getCapGrantedArea(capPack.readCap);

    const toArea: Area<IdentityPublicKey> = {
      includedSubspaceId: restrictTo.identity ||
        grantedArea.includedSubspaceId,
      pathPrefix: restrictToPath?.underlying ||
        grantedArea.pathPrefix,
      timeRange: restrictTo.time || grantedArea.timeRange,
    };

    if (capPack.subspaceCap === undefined) {
      if (meadowcap.isCommunal(capPack.readCap)) {
        const delegated = await meadowcap.delegateCapCommunal(
          {
            cap: capPack.readCap,
            secret: receiverKeypair.secretKey,
            user: toUser,
            area: toArea,
          },
        );

        return { readCap: delegated };
      }

      const delegated = await meadowcap.delegateCapOwned(
        {
          cap: capPack.readCap,
          secret: receiverKeypair.secretKey,
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
        secret: receiverKeypair.secretKey,
        user: toUser,
        area: toArea,
      },
    );

    const delegatedSubspaceCap = await meadowcap.delegateSubspaceCap(
      capPack.subspaceCap,
      toUser,
      receiverKeypair.secretKey,
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
        const encoded = encodeCapPack(capPack);
        const encrypted = await this.encrypt(encoded);

        await this.kvDriver.set([
          "cap",
          cap.accessMode,
          crypto.getRandomValues(new Uint8Array(32)),
        ], encrypted);

        return true;
      }
    }

    return new AuthorisationError(
      "No corresponding keypair held for the given cap pack.",
    );
  }

  /** Iterate through read access cap packs in safe storage. */
  async *readCapPacks(
    selectors?: CapPackSelector[],
  ): AsyncIterable<ReadCapPack> {
    for await (
      const { value } of this.kvDriver.list<Uint8Array>({
        prefix: ["cap", "read"],
      })
    ) {
      const decrypted = await this.decrypt(value);

      const capPack = decodeCapPack(decrypted) as ReadCapPack;

      if (!selectors) {
        yield capPack;
        continue;
      }

      const grantedNamespace = Meadowcap.getGrantedNamespace(
        capPack.readCap,
      );
      const grantedArea = meadowcap.getCapGrantedArea(capPack.readCap);

      for (const selector of selectors) {
        const hasSameNamespace = namespaceScheme.isEqual(
          selector.share,
          grantedNamespace,
        );

        if (!hasSameNamespace) {
          continue;
        }

        if (!selector.areas) {
          yield capPack;
          break;
        }

        for (const area of selector.areas) {
          const isIncluded = areaIsIncluded(
            subspaceScheme.order,
            area,
            grantedArea,
          );

          if (!isIncluded) {
            continue;
          }

          yield capPack;
          break;
        }
      }
    }
  }

  /** Iterate through write access cap packs in safe storage. */
  async *writeCapPacks(
    selectors?: CapPackSelector[],
  ): AsyncIterable<WriteCapPack> {
    // Find keypairs
    for await (
      const { value } of this.kvDriver.list<Uint8Array>({
        prefix: ["cap", "write"],
      })
    ) {
      const capBytes = await this.decrypt(value);

      const capPack = decodeCapPack(capBytes) as WriteCapPack;

      if (!selectors) {
        yield capPack;
        continue;
      }

      const grantedNamespace = Meadowcap.getGrantedNamespace(
        capPack.writeCap,
      );
      const grantedArea = meadowcap.getCapGrantedArea(capPack.writeCap);

      for (const selector of selectors) {
        const hasSameNamespace = namespaceScheme.isEqual(
          selector.share,
          grantedNamespace,
        );

        if (!hasSameNamespace) {
          continue;
        }

        if (!selector.areas) {
          yield capPack;
          break;
        }

        for (const area of selector.areas) {
          const isIncluded = areaIsIncluded(
            subspaceScheme.order,
            area,
            grantedArea,
          );

          if (!isIncluded) {
            continue;
          }

          yield capPack;
          break;
        }
      }
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
        (async () => {
          for await (const writeCapPack of this.writeCapPacks()) {
            const tag = encodeShareTag(writeCapPack.writeCap.namespaceKey);

            if (foundShares.has(tag)) {
              continue;
            }

            foundShares.add(tag);
            sharePublicKeys.push(writeCapPack.writeCap.namespaceKey);
          }
        })(),
        (async () => {
          for await (const readCapPacks of this.readCapPacks()) {
            const tag = encodeShareTag(readCapPacks.readCap.namespaceKey);

            if (foundShares.has(tag)) {
              continue;
            }

            foundShares.add(tag);
            sharePublicKeys.push(readCapPacks.readCap.namespaceKey);
          }
        })(),
      ],
    );

    return sharePublicKeys;
  }

  async getWriteAuthorisation(
    share: SharePublicKey,
    subspace: IdentityPublicKey,
    path: Path,
    timestamp: bigint,
  ): Promise<
    {
      cap: Capability;
      receiverKeypair: IdentityKeypairRaw;
    } | undefined
  > {
    const foundAuthorisations = [];

    for await (
      const capPack of this.writeCapPacks([{
        share,
        areas: [{
          includedSubspaceId: subspace,
          pathPrefix: path.underlying,
          timeRange: {
            start: timestamp,
            end: timestamp + 1n,
          },
        }],
      }])
    ) {
      const receiver = meadowcap.getCapReceiver(capPack.writeCap);

      const keypair = await this.identityKeypair(receiver);

      if (!keypair) {
        throw new EarthstarError(
          "Malformed auth data: no corresponding keypair for held capability",
        );
      }

      foundAuthorisations.push({
        cap: capPack.writeCap,
        receiverKeypair: keypair,
      });
    }

    if (foundAuthorisations.length === 0) {
      return undefined;
    } else if (foundAuthorisations.length === 1) {
      return foundAuthorisations[0];
    }

    // Find the most powerful capability
    // and then the one with the least delegations
    // or the other way around?

    let candidateAuth = foundAuthorisations[0];

    for (let i = 1; i < foundAuthorisations.length; i++) {
      const contenderAuth = foundAuthorisations[i];

      if (
        candidateAuth.cap.delegations.length <
          contenderAuth.cap.delegations.length
      ) {
        continue;
      } else if (
        contenderAuth.cap.delegations.length <
          candidateAuth.cap.delegations.length
      ) {
        candidateAuth = contenderAuth;
        continue;
      }

      const candidateArea = meadowcap.getCapGrantedArea(candidateAuth.cap);
      const contenderArea = meadowcap.getCapGrantedArea(contenderAuth.cap);

      if (areaIsIncluded(subspaceScheme.order, candidateArea, contenderArea)) {
        candidateAuth = contenderAuth;
      }
    }

    return candidateAuth;
  }

  /** Generate a map of {@linkcode SyncInterests} based on the read capabilities in secure storage.
   *
   * If two capabilities from the same share are such that one completely includes the other, only the larger capability will be chosen.
   */
  async interestsFromCaps(
    selectors?: CapPackSelector[],
  ): Promise<SyncInterests> {
    const interests: SyncInterests = new Map();

    const mostPowerfulCaps = new Map<ShareTag, Set<ReadCapPack>>();

    for await (const capPack of this.readCapPacks(selectors)) {
      const shareTag = encodeShareTag(capPack.readCap.namespaceKey);
      const grantedArea = meadowcap.getCapGrantedArea(capPack.readCap);

      const otherAreas = mostPowerfulCaps.get(shareTag);

      let isRedundant = false;

      if (!otherAreas) {
        mostPowerfulCaps.set(shareTag, new Set([capPack]));
        continue;
      }

      for (const otherCapPack of otherAreas.values()) {
        const otherGrantedArea = meadowcap.getCapGrantedArea(
          otherCapPack.readCap,
        );

        if (
          areaIsIncluded(subspaceScheme.order, grantedArea, otherGrantedArea)
        ) {
          isRedundant = true;
        } else if (
          areaIsIncluded(subspaceScheme.order, otherGrantedArea, grantedArea)
        ) {
          otherAreas.delete(otherCapPack);
        }
      }

      if (!isRedundant) {
        otherAreas.add(capPack);
      }
    }

    for (const capPacks of mostPowerfulCaps.values()) {
      for (const capPack of capPacks.values()) {
        const grantedArea = meadowcap.getCapGrantedArea(capPack.readCap);

        if (capPack.subspaceCap) {
          interests.set({
            capability: capPack.readCap,
            subspaceCapability: capPack.subspaceCap,
          }, [{
            area: grantedArea,
            maxCount: 0,
            maxSize: 0n,
          }]);
        } else {
          interests.set({
            capability: capPack.readCap,
          }, [{
            area: grantedArea,
            maxCount: 0,
            maxSize: 0n,
          }]);
        }
      }
    }

    return interests;
  }
}

function encodeIdentityKeypair(keypair: IdentityKeypairRaw): Uint8Array {
  const publicKeyEncoded = encodeIdentityPublicKey(keypair.publicKey);
  return concat(publicKeyEncoded, keypair.secretKey);
}

function decodeIdentityKeypair(encoded: Uint8Array): IdentityKeypairRaw {
  const publicKeyEncoded = encoded.subarray(0, 36);

  const publicKey = decodeIdentityPublicKey(publicKeyEncoded);

  return {
    publicKey,
    secretKey: encoded.slice(36),
  };
}

function encodeShareKeypair(keypair: ShareKeypairRaw): Uint8Array {
  const publicKeyEncoded = encodeSharePublicKey(keypair.publicKey);

  return concat(publicKeyEncoded, keypair.secretKey);
}

function decodeShareKeypair(encoded: Uint8Array): IdentityKeypairRaw {
  const publicKey = decodeSharePublicKey(encoded);
  const len = encodeSharePublicKey(publicKey).length;

  return {
    publicKey,
    secretKey: encoded.slice(len),
  };
}
