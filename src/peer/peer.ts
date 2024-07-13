import { IS_ALFIE, type KvDriver, TransportWebsocket } from "@earthstar/willow";
import { Auth } from "../auth/auth.ts";
import { Cap } from "../caps/cap.ts";
import { decodeCapPack } from "../caps/util.ts";
import {
  decodeIdentityTag,
  encodeIdentityTag,
  type IdentityKeypair,
  type IdentityTag,
} from "../identifiers/identity.ts";
import {
  decodeShareTag,
  encodeShareTag,
  isCommunalShare,
  type ShareKeypair,
  type ShareKeypairRaw,
  type ShareTag,
} from "../identifiers/share.ts";
import { Store } from "../store/store.ts";
import { Syncer } from "../syncer/syncer.ts";
import { EarthstarError, isErr, ValidationError } from "../util/errors.ts";
import { capSelectorsToCapPackSelectors } from "./util.ts";
import type {
  CapSelector,
  PeerOpts,
  RuntimeDriver,
  StorageDriver,
} from "./types.ts";
import { decodeBase32, encodeBase32 } from "../encoding/base32.ts";

/** Stores and generates keypairs and capabilities and exposes access to {@linkcode Store}s and {@linkcode Cap}s based on those.
 *
 * ```
 * const peer = new Peer({
 *   password: "password1234",
 *   runtime: new RuntimeDriverUniversal(),
 *   storage: new StorageDriverMemory(),
 * });
 *
 * const keypair = await peer.createIdentity("suzy");
 * const share = await peer.createShare("gardening", true);
 * const suzyWriteCap = await peer.mintCap(
 *   share,
 *   keypair.tag,
 *   "write",
 * );
 * const store = await peer.getStore(share);
 *
 * await store.set({
 *   identity: keypair.tag,
 *   path: Path.fromStrings("greetings", "casual"),
 *   payload: new TextEncoder().encode("Hello world!"),
 * });
 * ```
 */
export class Peer {
  /** The peer's underlying {@linkcode} Auth instance, exposed here for low-level operations. */
  readonly auth: Auth;

  /** Resets the password and irrevocably deletes all previously stored identity keypairs, share keypairs, and capabalities. */
  static reset(driver: KvDriver): Promise<void> {
    return Auth.reset(driver);
  }

  private storeMap = new Map<string, Store>();

  private runtime: RuntimeDriver;

  private storageDriver: StorageDriver;

  /** Construct a new {@linkcode Peer}. */
  constructor(opts: PeerOpts) {
    this.auth = new Auth({
      password: opts.password,
      kvDriver: opts.storage.auth,
      runtimeDriver: opts.runtime,
    });

    this.storageDriver = opts.storage;

    this.runtime = opts.runtime;
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
      secretKey: encodeBase32(result.secretKey),
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

    try {
      return this.auth.addIdentityKeypair({
        publicKey: decodedTag,
        secretKey: decodeBase32(keypair.secretKey),
      });
    } catch {
      return Promise.resolve(new ValidationError("Invalid secret"));
    }
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
      secretKey: encodeBase32(keypair.secretKey),
    };
  }

  /** Iterate though all {@linkcode IdentityKeypair}s stored in the {@linkcode Peer}. */
  async *identities(): AsyncIterable<IdentityKeypair> {
    for await (const keypair of this.auth.identityKeypairs()) {
      yield {
        tag: encodeIdentityTag(keypair.publicKey),
        secretKey: encodeBase32(keypair.secretKey),
      };
    }
  }

  /** Create a new communal share using a short name.
   *
   * Once a share has been created, a corresponding {@linkcode Store} can be retrieved from the peer.
   *
   * @param shortname A 1-15 character name for the share, containing only numbers and lowercase letters, and which must start with a letter.
   * @param communal Whether the share is [communal or owned](https://willowprotocol.org/specs/meadowcap/index.html#meadowcap_overview).
   *
   * @returns The {@linkcode ShareTag} of the new share.
   */
  createShare(
    shortname: string,
    communal: true,
  ): Promise<ShareTag | ValidationError>;
  /** Create a new owned share using a short name.
   *
   * Once a share has been created, a corresponding {@linkcode Store} can be retrieved from the peer.
   *
   * @param shortname A 1-15 character name for the share, containing only numbers and lowercase letters, and which must start with a letter.
   * @param communal Whether the share is [communal or owned](https://willowprotocol.org/specs/meadowcap/index.html#meadowcap_overview).
   *
   * @returns The {@linkcode ShareKeypair} of the new share.
   */
  createShare(
    shortname: string,
    communal: false,
  ): Promise<ShareKeypair | ValidationError>;
  /** Create a new share and store any information in the peer.
   *
   * Once a share has been created, a corresponding {@linkcode Store} can be retrieved from the peer.
   *
   * It's recommended to store keypairs in an additional secure storage, e.g. a password manager.
   *
   * @param shortname A 1-15 character name for the share, containing only numbers and lowercase letters, and which must start with a letter.
   * @param communal Whether the share is [communal or owned](https://willowprotocol.org/specs/meadowcap/index.html#meadowcap_overview).
   *
   * @returns A {@linkcode ShareTag} if the new share is communal, a {@linkcode ShareKeypair} if it is owned, or {@linkcode ValidationError} if the given shortname is invalid.
   */
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
      secretKey: encodeBase32(keypair.secretKey),
    };
  }

  /** Store an existing share to the peer using a {@linkcode ShareTag} (for communal shares) or {@linkcode ShareKeypair} (for owned shares).
   *
   * Once an share keypair has been added, a {@linkcode Store} will become available from the {@linkcode Peer} if it isn't already.
   *
   * It's recommended to store keypairs in an additional secure storage, e.g. a password manager.
   *
   * @param share The tag of a communal share or the {@linkcode ShareKeypair} of an owned share.
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

      try {
        return await this.auth.addShareKeypair({
          publicKey,
          secretKey: decodeBase32(share.secretKey),
        });
      } catch {
        return new ValidationError("Invalid secret");
      }
    }

    const publicKey = decodeShareTag(share);

    if (isErr(publicKey)) {
      return publicKey;
    }

    const result = await this.auth.addShareKeypair({
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

  /** Iterate through all stored {@linkcode Cap}s with read access which satisfy an (optional) {@linkcode CapQuery} */
  async *getReadCaps(selectors?: CapSelector[]): AsyncGenerator<Cap> {
    if (!selectors) {
      for await (const cap of this.auth.readCapPacks()) {
        yield new Cap(cap, this.auth);
      }

      return;
    }

    const capPackSelectors = capSelectorsToCapPackSelectors(selectors);

    if (isErr(capPackSelectors)) {
      return capPackSelectors;
    }

    for await (const cap of this.auth.readCapPacks(capPackSelectors)) {
      yield new Cap(cap, this.auth);
    }
  }

  /** Iterate through all stored {@linkcode Cap}s with write access which satisfy an (optional) {@linkcode CapQuery} */
  async *getWriteCaps(selectors?: CapSelector[]): AsyncGenerator<Cap> {
    if (!selectors) {
      for await (const cap of this.auth.writeCapPacks()) {
        yield new Cap(cap, this.auth);
      }

      return;
    }

    const capPackSelectors = capSelectorsToCapPackSelectors(selectors);

    if (isErr(capPackSelectors)) {
      return capPackSelectors;
    }

    for await (const cap of this.auth.writeCapPacks(capPackSelectors)) {
      yield new Cap(cap, this.auth);
    }
  }

  /** Imports an encoded capability to storage.
   *
   * @returns If the {@linkcode IdentityKeypair} for the given capability's receiver is known, a {@linkcode Cap}. Otherwise, a {@linkcode ValidationError}.
   */
  async importCap(cap: Uint8Array): Promise<Cap | ValidationError> {
    const decoded = decodeCapPack(cap, this.runtime);

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

  /** Retrieve a {@linkcode Store} for the share with a given tag.
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

    const drivers = await this.storageDriver.getStoreDrivers(
      decodedShare,
      this.runtime,
    );

    const newStore = new Store(share, this.auth, {
      entryDriver: drivers.entry,
      payloadDriver: drivers.payload,
      runtimeDriver: this.runtime,
    });

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

  /** Sync with a peer with a publicly reachable address over HTTP using a websocket connection.
   *
   * @param url - The address of the peer to sync with.
   * @param interests - An optional array of {@linkcode CapSelector} to select areas of interest to sync by. All selectors with a corresponding read capability in storage will be included when syncing.
   */
  async syncHttp(
    url: string,
    interests?: CapSelector[],
  ): Promise<Syncer | ValidationError> {
    try {
      new URL(url);
    } catch {
      return new ValidationError("Invalid URL provided");
    }

    const socket = new WebSocket(url);
    const transport = new TransportWebsocket(IS_ALFIE, socket);

    const selectors = interests
      ? capSelectorsToCapPackSelectors(interests)
      : undefined;

    if (isErr(selectors)) {
      return selectors;
    }

    const syncer = new Syncer({
      auth: this.auth,
      getStore: async (share) => {
        const tag = encodeShareTag(share);

        const result = await this.getStore(tag);

        if (isErr(result)) {
          throw new EarthstarError(
            "Could not get Store requested by Syncer.",
          );
        }

        return result;
      },
      maxPayloadSizePower: 8,
      transport: transport,
      interests: await this.auth.interestsFromCaps(selectors),
      runtime: this.runtime,
    });

    return syncer;
  }
}
