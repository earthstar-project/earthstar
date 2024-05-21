import * as Willow from "@earthstar/willow";
import type { Auth, AuthorisationToken } from "../auth/auth.ts";
import type { Blake3Digest } from "../blake3/types.ts";
import type {
  ReadCapability,
  SubspaceCapability,
  WriteCapability,
} from "../caps/types.ts";
import type { IdentityPublicKey } from "../identifiers/identity.ts";
import type { SharePublicKey } from "../identifiers/share.ts";
import {
  fingerprintScheme,
  makeAccessControlScheme,
  makeAuthorisationScheme,
  makeAuthorisationTokenScheme,
  makePaiScheme,
  makePayloadScheme,
  makeSubspaceCapScheme,
  namespaceScheme,
  pathScheme,
  subspaceScheme,
} from "../schemes/schemes.ts";
import type { Store } from "../store/store.ts";
import type { AuthorisationOpts, PreFingerprint } from "../store/types.ts";
import type { AreaOfInterest } from "@earthstar/willow-utils";
import type { RuntimeDriver } from "../peer/types.ts";

/** A {@linkcode ReadCapability} and possibly accompanying {@linkcode SubspaceCapability} */
export type ReadAuthorisation = Willow.ReadAuthorisation<
  ReadCapability,
  SubspaceCapability
>;

/** A mapping of {@linkcode ReadAuthorisation} to {@linkcode AreaOfInterest}s permitted by that authorisation. */
export type SyncInterests = Map<
  ReadAuthorisation,
  AreaOfInterest<IdentityPublicKey>[]
>;

/** A transport for exchanging bytes with another peer. */
export type Transport = Willow.Transport;

/** Options for instantiating a {@linkcode Syncer}. */
export type SyncerOpts = {
  auth: Auth;
  transport: Transport;
  interests: SyncInterests;
  maxPayloadSizePower: number;
  getStore: (share: SharePublicKey) => Promise<Store>;
  runtime: RuntimeDriver;
};

/** Synchronises different shares known by a {@linkcode Peer}.
 */
export class Syncer {
  private wgpsMessenger: Willow.WgpsMessenger<
    ReadCapability,
    IdentityPublicKey,
    Uint8Array,
    Uint8Array,
    Uint8Array,
    Uint8Array,
    SubspaceCapability,
    IdentityPublicKey,
    Uint8Array,
    Uint8Array,
    PreFingerprint,
    Uint8Array,
    AuthorisationToken,
    WriteCapability,
    Uint8Array,
    SharePublicKey,
    IdentityPublicKey,
    Blake3Digest,
    AuthorisationOpts
  >;

  /** Construct a new {@linkcode Syncer}. You shouldn't need to, normally, as {@linkcode Peer} handles that all for you. */
  constructor(opts: SyncerOpts) {
    this.wgpsMessenger = new Willow.WgpsMessenger({
      transport: opts.transport,
      interests: opts.interests,
      maxPayloadSizePower: opts.maxPayloadSizePower,
      challengeLength: 16,
      challengeHashLength: 32,
      challengeHash: (bytes) => {
        return opts.runtime.blake3(bytes);
      },
      getStore: async (namespace) => {
        const store = await opts.getStore(namespace);
        return store.willow;
      },
      transformPayload: (bytes) => bytes,
      processReceivedPayload: (bytes) => bytes,
      schemes: {
        namespace: namespaceScheme,
        subspace: subspaceScheme,
        payload: makePayloadScheme(opts.runtime.blake3),
        fingerprint: fingerprintScheme,
        path: pathScheme,
        accessControl: makeAccessControlScheme(
          opts.auth,
          opts.runtime.ed25519,
          opts.runtime.blake3,
        ),
        subspaceCap: makeSubspaceCapScheme(
          opts.auth,
          opts.runtime.ed25519,
          opts.runtime.blake3,
        ),
        authorisation: makeAuthorisationScheme(
          opts.runtime.ed25519,
          opts.runtime.blake3,
        ),
        authorisationToken: makeAuthorisationTokenScheme(
          opts.runtime.ed25519,
          opts.runtime.blake3,
        ),
        pai: makePaiScheme(
          opts.runtime.ed25519,
          opts.runtime.blake3,
        ),
      },
    });
  }

  /** Stop syncing and terminate the connection. */
  close() {
    this.wgpsMessenger.close();
  }
}
