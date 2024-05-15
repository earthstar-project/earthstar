import { KvDriverInMemory } from "../../../willow-js/src/store/storage/kv/kv_driver_in_memory.ts";
import { ANY_SUBSPACE, OPEN_END, Path, Willow } from "../../deps.ts";
import { Auth } from "../auth/auth.ts";
import { Cap } from "../caps/cap.ts";
import { decodeCapPack } from "../caps/util.ts";
import {
  decodeIdentityTag,
  encodeIdentityTag,
  IdentityKeypair,
  IdentityTag,
} from "../identifiers/identity.ts";
import {
  decodeShareTag,
  encodeShareTag,
  isCommunalShare,
  ShareKeypair,
  ShareKeypairRaw,
  SharePublicKey,
  ShareTag,
} from "../identifiers/share.ts";
import { Store } from "../store/store.ts";
import { Syncer, SyncInterests } from "../syncer/syncer.ts";

import { EarthstarError, isErr, ValidationError } from "../util/errors.ts";

/** A query which selects all capabilities which include the given parameters. */
export type CapQuery = {
  /** The share the capability grants access to. */
  share: ShareTag;
  /** An optional identity the cap must be able to permit access to. */
  identity?: IdentityTag;
  /** An optional path prefix the cap must be able to permit access to. */
  pathPrefix?: Path;
  /** An optional time range the cap must be able to permit access to..  */
  time?: {
    start: number;
    end?: number;
  };
};

export type PeerDriver = {
  authDriver: Willow.KvDriver;
  createStore: (share: SharePublicKey) => Promise<Store>;
};

export type PeerOpts = {
  /** A plaintext password used to encrypt sensitive information stored within the peer, such as keypairs or capabilities. */
  password: string;
  driver?: PeerDriver;
};

/** Stores and generates keypairs and capabilities and exposes access to {@linkcode Store}s based on those. */
export class Peer {
  /** Resets the password and irrevocably deletes all previously stored identity keypairs, share keypairs, and capabalities. */
  static reset(driver: PeerDriver): Promise<void> {
    return Auth.reset(driver.authDriver);
  }

  private auth: Auth;
  private createStoreFn: (share: SharePublicKey, auth: Auth) => Promise<Store>;
  private storeMap = new Map<string, Store>();

  constructor(opts: PeerOpts) {
    this.auth = new Auth({
      password: opts.password,
      kvDriver: opts.driver?.authDriver || new KvDriverInMemory(),
    });

    this.createStoreFn = opts.driver?.createStore ||
      ((share, auth) =>
        Promise.resolve(new Store(encodeShareTag(share), auth)));
  }

  /** Create a new {@linkcode IdentityKeypair} and store it in the peer.
   *
   * Once an identity keypair has been added, capabilities given to that identity can be added to the peer.
   *
   * It's recommended to store keypairs in an additional secure storage, e.g. a password manager.
   *
   * @param shortname A four character name to attach to the keypair for identification. Can only contain numbers and lowercase letters and must start with a letter.
   */
  async createIdentity(
    shortname: string,
  ): Promise<IdentityKeypair | ValidationError> {
    const result = await this.auth.createIdentityKeypair(shortname);

    if (isErr(result)) {
      return result;
    }

    return {
      tag: encodeIdentityTag(result.publicKey),
      secretKey: result.secretKey,
    };
  }

  /** Store an existing {@linkcode IdentityKeypair} in the peer.
   *
   * Once an identity keypair has been added, capabilities given to that identity can be added to the peer.
   *
   * It's recommended to store keypairs in an additional secure storage, e.g. a password manager.
   */
  addExistingIdentity(
    keypair: IdentityKeypair,
  ): Promise<true | ValidationError> {
    const decodedTag = decodeIdentityTag(keypair.tag);

    if (isErr(decodedTag)) {
      return Promise.resolve(decodedTag);
    }

    return this.auth.addIdentityKeypair({
      publicKey: decodedTag,
      secretKey: keypair.secretKey,
    });
  }

  /** Retrieve a stored {@linkcode IdentityKeypair} using its tag. */
  async getIdentityKeypair(
    tag: IdentityTag,
  ): Promise<IdentityKeypair | ValidationError | undefined> {
    const publicKey = decodeIdentityTag(tag);

    if (isErr(publicKey)) {
      return Promise.resolve(publicKey);
    }

    const keypair = await this.auth.identityKeypair(publicKey);

    if (!keypair) {
      return undefined;
    }

    return {
      tag: encodeIdentityTag(keypair.publicKey),
      secretKey: keypair.secretKey,
    };
  }

  /** Create a new {@linkcode Share} and store any information in the peer.
   *
   * Once a share has been created, a corresponding {@linkcode Store} can be retrieved from the peer.
   *
   * It's recommended to store keypairs in an additional secure storage, e.g. a password manager.
   *
   * @param shortname A 1-15 character name for the share, containing only numbers and lowercase letters, and which must start with a letter.
   * @param communal Whether the share is [communal or owned](https://willowprotocol.org/specs/meadowcap/index.html#meadowcap_overview).
   *
   * @returns A tag if the new share is communal, a {@linkcode ShareKeypairRaw} if it is owned, or {@linkcode ValidationError} if the given shortname is invalid.
   */
  createShare(
    shortname: string,
    communal: true,
  ): Promise<ShareTag | ValidationError>;
  createShare(
    shortname: string,
    communal: false,
  ): Promise<ShareKeypair | ValidationError>;
  async createShare(
    shortname: string,
    communal: boolean,
  ): Promise<ShareKeypair | ShareTag | ValidationError> {
    const keypair = await this.auth.createShareKeypair(shortname, !communal);

    if (isErr(keypair)) {
      return keypair;
    }

    if (communal) {
      return encodeShareTag(keypair.publicKey);
    }

    return {
      tag: encodeShareTag(keypair.publicKey),
      secretKey: keypair.secretKey,
    };
  }

  /** Store an existing {@linkcode IdentityKeypair} in the peer.
   *
   * Once an identity keypair has been added, capabilities given to that identity can be added to the peer.
   *
   * It's recommended to store keypairs in an additional secure storage, e.g. a password manager.
   *
   * @param share The tag of a communal share or the {@linkcode ShareKeypairRaw} of an owned share.
   *
   * @returns `true` if the operation was successful, or a {@linkcode ValidationError} if the keypair for an owned share was invalid.
   */
  async addExistingShare(
    share: ShareKeypair | ShareTag,
  ): Promise<true | ValidationError> {
    if (typeof share !== "string") {
      const publicKey = decodeShareTag(share.tag);

      if (isErr(publicKey)) {
        return publicKey;
      }

      return await this.auth.addIdentityKeypair({
        publicKey,
        secretKey: share.secretKey,
      });
    }

    const publicKey = decodeShareTag(share);

    if (isErr(publicKey)) {
      return publicKey;
    }

    const result = await this.auth.addIdentityKeypair({
      publicKey,
      secretKey: new Uint8Array(),
    });

    return result;
  }

  /** Retrieve a stored {@linkcode IdentityKeypair} using its tag.
   *
   * @returns An {@linkcode IdentityKeypair} if the given keypair was stored and owned, or a {@linkcode ValidationError} if the given tag was for a communal share.
   */
  getShareKeypair(
    tag: IdentityTag,
  ): Promise<ShareKeypairRaw | ValidationError | undefined> {
    const publicKey = decodeIdentityTag(tag);

    if (isErr(publicKey)) {
      return Promise.resolve(publicKey);
    }

    if (isCommunalShare(publicKey)) {
      return Promise.resolve(
        new ValidationError("Communal shares do not need keypairs."),
      );
    }

    return this.auth.identityKeypair(publicKey);
  }

  /** Iterate through all read capabilities satisfying an (optional) {@linkcode CapQuery} */
  async *getReadCapabilities(query?: CapQuery) {
    if (!query) {
      for await (const cap of this.auth.readCapPacks()) {
        yield cap;
      }

      return;
    }

    const params = capQueryToCapParams(query);

    if (isErr(params)) {
      return params;
    }

    for await (const cap of this.auth.readCapPacks(...params)) {
      yield cap;
    }
  }

  /** Iterate through all write capabilities satisfying an (optional) {@linkcode CapQuery} */
  async *getWriteCapabilities(query?: CapQuery) {
    if (!query) {
      for await (const cap of this.auth.writeCapPacks()) {
        yield cap;
      }

      return;
    }

    const params = capQueryToCapParams(query);

    if (isErr(params)) {
      return params;
    }

    for await (const cap of this.auth.writeCapPacks(...params)) {
      yield cap;
    }
  }

  /** Imports an encoded capability to storage.
   *
   * @returns If the {@linkcode IdentityKeypair} for the given capability's receiver is known, a {@linkcode Cap}. Otherwise, a {@linkcode ValidationError}.
   */
  async importCap(cap: Uint8Array): Promise<Cap | ValidationError> {
    const decoded = decodeCapPack(cap);

    const result = await this.auth.addCapPack(decoded);

    if (isErr(result)) {
      return result;
    }

    return new Cap(decoded, this.auth);
  }

  /** Mint a new root capability for a given share.
   *
   * @param share The {@linkcode ShareTag} of the share the new cap should grant a capability for.
   *  @param forUser The {@linkcode IdentityTag} of the receiver of this capability. If the given share is communal, the new share will be restricted to this identity.
   * @param accessMode Whether the new capability should grant read or write access.
   */
  async mintCap(
    share: ShareTag,
    forUser: IdentityTag,
    accessMode: "read" | "write",
  ): Promise<Cap | ValidationError> {
    const sharePublicKey = decodeShareTag(share);

    if (isErr(sharePublicKey)) {
      return sharePublicKey;
    }

    const identityPublicKey = decodeIdentityTag(forUser);

    if (isErr(identityPublicKey)) {
      return identityPublicKey;
    }

    const capPack = await this.auth.createFullCapPack(
      sharePublicKey,
      identityPublicKey,
      accessMode as "read",
    );

    if (isErr(capPack)) {
      return capPack;
    }

    return new Cap(capPack, this.auth);
  }

  /** Retrive a {@linkcode Store} for the share with a given tag.
   *
   * @returns A {@linkcode Store} if any authorised capabilities for that share are held, otherwise a {@linkcode ValidationError}.
   */
  async getStore(
    share: ShareTag,
  ): Promise<Store | ValidationError> {
    const decodedShare = decodeShareTag(share);

    if (isErr(decodedShare)) {
      return decodedShare;
    }

    if (!(await this.shares()).includes(share)) {
      return new ValidationError(
        "Can't get a Store for a share for which we have no authorised capabilities.",
      );
    }

    const existing = this.storeMap.get(share);

    if (existing) {
      return existing;
    }

    const newStore = await this.createStoreFn(decodedShare, this.auth);

    this.storeMap.set(share, newStore);

    return newStore;
  }

  /** All shares for which the peer has read or write access to.
   *
   * Read or write access to a share is determined by whether the peer has read or write capabilities for that share, _and_ whether the corresponding keypairs for those capabilities' receivers are in storage.
   */
  async shares(): Promise<ShareTag[]> {
    const shares = await this.auth.allAuthorisedShares();

    const tags = [];

    for (const share of shares) {
      tags.push(encodeShareTag(share));
    }

    return tags;
  }
}

function capQueryToCapParams(
  query: CapQuery,
): Parameters<Auth["readCapPacks"]> | ValidationError {
  if (!query.share) {
    return [undefined, undefined];
  }

  const sharePublicKey = decodeShareTag(query.share);

  if (isErr(sharePublicKey)) {
    return sharePublicKey;
  }

  if (
    query.identity === undefined && query.pathPrefix === undefined &&
    query.time === undefined
  ) {
    return [sharePublicKey, undefined];
  }

  const subspace = query.identity
    ? decodeIdentityTag(query.identity)
    : undefined;

  if (isErr(subspace)) {
    return subspace;
  }

  return [sharePublicKey, {
    includedSubspaceId: subspace || ANY_SUBSPACE,
    pathPrefix: query.pathPrefix || [],
    timeRange: query.time
      ? {
        start: BigInt(query.time.start),
        end: query.time.end ? BigInt(query.time.end) : OPEN_END,
      }
      : {
        start: 0n,
        end: OPEN_END,
      },
  }];
}
