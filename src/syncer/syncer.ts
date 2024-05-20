import * as Willow from "@earthstar/willow";
import { Auth, AuthorisationToken } from "../auth/auth.ts";
import { Blake3Digest } from "../blake3/types.ts";
import {
  ReadCapability,
  SubspaceCapability,
  WriteCapability,
} from "../caps/types.ts";
import { IdentityPublicKey } from "../identifiers/identity.ts";
import { SharePublicKey } from "../identifiers/share.ts";
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
import { Store } from "../store/store.ts";
import { AuthorisationOpts, PreFingerprint } from "../store/types.ts";
import { AreaOfInterest } from "@earthstar/willow-utils";
import { RuntimeDriver } from "../peer/types.ts";

export type SyncInterests = Map<
  Willow.ReadAuthorisation<
    ReadCapability,
    SubspaceCapability
  >,
  AreaOfInterest<IdentityPublicKey>[]
>;

export type SyncerOpts = {
  auth: Auth;
  transport: Willow.Transport;
  interests: SyncInterests;
  maxPayloadSizePower: number;
  getStore: (share: SharePublicKey) => Promise<Store>;
  runtime: RuntimeDriver;
};

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

  close() {
    this.wgpsMessenger.close();
  }
}
