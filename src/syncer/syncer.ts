import * as Willow from "@earthstar/willow";
import { Auth, AuthorisationToken } from "../auth/auth.ts";
import { blake3 } from "../blake3/blake3.std.ts";
import { Blake3Digest } from "../blake3/types.ts";
import {
  ReadCapability,
  SubspaceCapability,
  WriteCapability,
} from "../caps/types.ts";
import { IdentityPublicKey } from "../identifiers/identity.ts";
import { SharePublicKey } from "../identifiers/share.ts";
import {
  authorisationScheme,
  authorisationTokenScheme,
  fingerprintScheme,
  makeAccessControlScheme,
  makeSubspaceCapScheme,
  namespaceScheme,
  paiScheme,
  pathScheme,
  payloadScheme,
  subspaceScheme,
} from "../schemes/schemes.ts";
import { Store } from "../store/store.ts";
import { AuthorisationOpts, PreFingerprint } from "../store/types.ts";
import { AreaOfInterest } from "@earthstar/willow-utils";

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
        return blake3(bytes);
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
        payload: payloadScheme,
        fingerprint: fingerprintScheme,
        path: pathScheme,
        accessControl: makeAccessControlScheme(opts.auth),
        subspaceCap: makeSubspaceCapScheme(opts.auth),
        authorisation: authorisationScheme,
        authorisationToken: authorisationTokenScheme,
        pai: paiScheme,
      },
    });
  }

  close() {
    this.wgpsMessenger.close();
  }
}
