import {
  OPEN_END,
  Path as WillowPath,
  isPathPrefixed,
  successorPath,
  Willow,
} from "../../../deps.ts";
import { AuthorisationToken, Capability } from "../../auth/auth.ts";
import { IdentityAddress, ShareAddress } from "../../crypto/types.ts";
import { EarthstarError, isErr, ValidationError } from "../../util/errors.ts";
import { earthstarToWillowPath, willowToEarthstarPath } from "../../util/path.ts";
import { Document, Query, SetEvent, StoreDriverOpts } from "../../store/types.ts";
import { Path } from "../../store/types.ts";

import { Store as BaseStore } from '../../store/store.ts';
import { bytesToString } from "https://deno.land/x/earthstar@v10.2.2/mod.ts";

import { parse } from "jsr:@std/yaml";
import { siv } from 'npm:@noble/ciphers@0.5.2/aes';
import { ed25519, x25519, edwardsToMontgomeryPub, edwardsToMontgomeryPriv } from 'npm:@noble/curves@1.4.0/ed25519';
import { hkdf } from 'npm:@noble/hashes@1.4.0/hkdf';
import { sha256 } from 'npm:@noble/hashes@1.4.0/sha256';
import { xchacha20poly1305 } from 'npm:@noble/ciphers@0.5.2/chacha';
import { managedNonce } from 'npm:@noble/ciphers@0.5.2/webcrypto';
import { IdentityKeypair } from "../../crypto/types.ts";
import { decodeKeypairAddressToBytes } from "../../crypto/keypair.ts";
import { parseIdentityAddress } from "../../core_validators/addresses.ts";
import { decodeBase32, encodeBase32 } from "../../encoding/base32.ts";

import { minimatch } from 'npm:minimatch'

const wxchacha20poly1305 = managedNonce(xchacha20poly1305);

export type EncryptionRule = {
  // from: TODO
  // to: TODO
  algorithm: 'aes-gcm-siv' | 'base32' | 'scalarmult-hkdf' | 'none' | 'wxchacha20poly1305';
  kdf: 'from-parent' | 'scalarmult-hkdf' | 'static';
  keyName: string;
  // pathPattern '*' can match an encrypted or plaintext element
  // others can only match plaintext elements
  pathPattern: string[];
  type: 'path' | 'payload';
}

export type EncryptionSetting = {
  rules: EncryptionRule[]; // Isn't really needed without from/to support tbh
};

/** A layer for implementing the /encryption/ & /keys/ spec on an underlying Store
 *
 * The interface for this is the same as for Store
 *
 * This doesn't allow for encrypting the payload of the empty path - as the settings are for the next level down
 * In practice.. The empty path, if set, overwrites the entire space - so isn't likely to actually be used for anything
 */
export class Store {
  /** The underlying Earthstar `Store`, made accessible for advanced usage and shenanigans. */
  baseStore: BaseStore;
  myIdentity: IdentityKeypair<Uint8Array>;

  constructor(
    store: BaseStore,
    myIdentity: IdentityKeypair<Uint8Array>,
  ) {
    this.baseStore = store;
    this.myIdentity = myIdentity;
  }

  // TODO: Watch events on underlying store, and update a cached encryption settings type thing
  // when relevant changes happen
  // This implementation is pretty meh without that, but eh, PoC.
  async getAllEncryptionSettings(
    identity: IdentityAddress,
  ): Promise<EncryptionRule[]> {
    const documents = await Array.fromAsync(this.baseStore.queryDocs({
      identity: identity,
      pathPrefix: ["encryption", "1.0"]
    }));

    // return documents;

    const rules: EncryptionRule[] = [];

    for (const doc of documents) {
      if (!doc.payload) {
        continue;
      }
      const bytes = await doc.payload.bytes();
      const docSettings = parse(bytesToString(bytes)) as EncryptionSetting;

      if (!docSettings.rules) {
        console.log(`Invalid encryption document found at ${identity}/${doc.path}`)
        continue;
      }

      rules.push(...docSettings.rules);
    }

    // sort rules with longest patterns first
    rules.sort((a, b) => b.pathPattern.length - a.pathPattern.length)
    return rules;
  }

  async getEncryptionSettingsForPath(
    identity: IdentityAddress,
    path: Path,
    type: 'path' | 'payload'
  ): Promise<EncryptionRule> {
    console.log(`getEncryptionSettingsForPath: ${identity}/${path}: ${type}`)

    const rules = await this.getAllEncryptionSettings(identity);

    for (const rule of rules) {
      if (rule.type != type) {
        // Wrong rule type
        continue;
      }
      if (minimatch(path.join("/"), rule.pathPattern.join("/"))) {
        // Found rule
        // Rules should be sorted with most specific first, so this is the right one
        return rule;
      }
    }

    return {
      algorithm: 'none',
      kdf: 'static',
      keyName: '',
      pathPattern: ["**"],
      type: type,
    }
  }

  // deriveKey gives you a key for a Path
  // You often need to know the decrypted Path for n-1
  // For encrypting a path element, you'll typically use the key for the parent
  async deriveKey(
    identity: IdentityAddress,
    path: Path,
    rule: EncryptionRule,
  ): Promise<Uint8Array> {
    console.log("deriveKey", {"me": this.myIdentity.identityAddress, identity, path, rule})
    switch(rule.kdf) {
      case "from-parent": {
        const parentSettings = await this.getEncryptionSettingsForPath(identity, path.slice(0, -1), "path");

        const key = await this.deriveKey(
          identity,
          path.slice(0, -1), // Key from parent
          parentSettings,
        )
        return hkdf(
          sha256,
          key,
          undefined,
          `subpath`,
          32,
        )
      }
      case "scalarmult-hkdf": {
        // Need to figure out who we are vs the subspace!
        // Owner or not etc
        // FIXME doesn't work for encryptedpath for our own subspace
        const privateKey = this.myIdentity.privateKey;
        let publicKey: Uint8Array;
        if (this.myIdentity.identityAddress == identity) {
          // This is my subspace, so the public key is the one in the path
          const pathIdentityAddress = path.slice(-1)[0];
          const parsedPathIdentityAddress = parseIdentityAddress(pathIdentityAddress);

          if (isErr(parsedPathIdentityAddress)) {
            throw parsedPathIdentityAddress;
          }

          publicKey = decodeBase32(parsedPathIdentityAddress.pubkey);
        } else {
          // This is someone else's subspace, so the public key is the subspace owner
          const parsedSubspaceIdentityAddress = parseIdentityAddress(identity);
          if (isErr(parsedSubspaceIdentityAddress)) {
            throw parsedSubspaceIdentityAddress;
          }
          publicKey = decodeBase32(parsedSubspaceIdentityAddress.pubkey);
        }
        const montgomeryPrivateKey = edwardsToMontgomeryPriv(privateKey);
        const montgomeryPublicKey = edwardsToMontgomeryPub(publicKey);
        const sharedSecret = x25519.getSharedSecret(montgomeryPrivateKey, montgomeryPublicKey);
        const info = `scalarmult-hkdf#${this.baseStore.willow.namespace}#${identity}#${path.slice(0, -1).join("/")}`
        const final = hkdf(
          sha256,
          sharedSecret,
          undefined,
          info,
          32,
        )
        console.log("deriveKey", {"me": this.myIdentity.identityAddress, identity, path, final})
        return final;
      }
      case "static": {
        throw new Error("Not Implemented");
      }
    }
  }

  async encryptPath(
    identity: IdentityAddress,
    path: Path,
  ) {
    if (path[0] == "encryption") {
      return path; // Short circuit to avoid weirdness
    }

    const encryptedPath: Path = [];
    for (let i=0; i<path.length; i++) {
      const tmpPath: Path = path.slice(0, i+1);
      const elemSettings = await this.getEncryptionSettingsForPath(identity, tmpPath, "path");
      let elem: string;
      const plain = tmpPath.slice(-1)[0];

      switch(elemSettings.algorithm) {
        case "aes-gcm-siv": {
          const key = await this.deriveKey(
            identity,
            tmpPath,
            elemSettings,
          )
          const stream = siv(key, new Uint8Array(12))
          elem = encodeBase32(stream.encrypt(new TextEncoder().encode(plain)))
          break;
        }
        case "scalarmult-hkdf": {
          const key = await this.deriveKey(
            identity,
            tmpPath,
            elemSettings,
          )
          const elemKey = hkdf(
            sha256,
            key,
            undefined,
            "path-disclosed-hkdf-not-secret-now",
            32,
          )
          elem = encodeBase32(elemKey);
          break;
        }
        case "none": {
          elem = plain;
          break;
        }
        case "base32": {
          elem = encodeBase32(new TextEncoder().encode(plain));
          break;
        }
        default: {
          throw new Error("Algorithm not allowed in this context");
        }
      }
      encryptedPath.push(elem);
    }

    return encryptedPath;
  }

  async encryptPayload(
    identity: IdentityAddress,
    path: Path,
    payload: Uint8Array | AsyncIterable<Uint8Array>,
  ): Promise<Uint8Array | AsyncIterable<Uint8Array>> {
    if (path[0] == "encryption") {
      return payload;
    }

    const elemSettings = await this.getEncryptionSettingsForPath(identity, path, "payload");

    switch(elemSettings.algorithm) {
      case "none": {
        return payload;
      }
      case "base32": {
        const bytes = payload instanceof Uint8Array
        ? payload
        : new Uint8Array(await Willow.collectUint8Arrays(payload));
        return new TextEncoder().encode(encodeBase32(bytes));
      }
      case "wxchacha20poly1305": {
        const key = await this.deriveKey(
          identity,
          path,
          elemSettings,
        )
        const bytes = payload instanceof Uint8Array
        ? payload
        : new Uint8Array(await Willow.collectUint8Arrays(payload));
        return wxchacha20poly1305(key).encrypt(bytes);
      }
      default: {
        throw new Error("Algorithm not allowed in this context");
      }
    }
  }

  async decryptPath(
    identity: IdentityAddress,
    path: Path,
  ) {
    if (path[0] == "encryption") {
      return path; // Short circuit to avoid weirdness
    }

    const decryptedPath: Path = [];
    for (let i=0; i<path.length; i++) {
      const tmpPath: Path = path.slice(0, i+1);
      const elemSettings = await this.getEncryptionSettingsForPath(identity, tmpPath, "path");
      let elem: string;
      const encrypted = tmpPath.slice(-1)[0];
      switch(elemSettings.algorithm) {
        case "aes-gcm-siv": {
          const key = await this.deriveKey(
            identity,
            tmpPath,
            elemSettings,
          )
          const stream = siv(key, new Uint8Array(12))
          elem = new TextDecoder().decode(stream.decrypt(decodeBase32(encrypted)));
          break;
        }
        case "scalarmult-hkdf": {
          // This is a bit magic. We can't really "decrypt" so much as
          // guess if this is right, and if so, return it
          // if not... we need error handling for failed decryption?
          const key = await this.deriveKey(
            identity,
            tmpPath,
            elemSettings,
          )
          const elemKey = hkdf(
            sha256,
            key,
            undefined,
            "path-disclosed-hkdf-not-secret-now",
            32,
          )
          const candidate = encodeBase32(elemKey);
          if (candidate == encrypted) {
            // Tada, this is what we were expecting!
            // FIXME this only works for decrypting someone elses subspace
            elem = this.myIdentity.identityAddress
          } else {
            throw new Error("Cannot decrypt");
          }
          break;
        }
        case "none": {
          elem = encrypted;
          break;
        }
        case "base32": {
          elem = new TextDecoder().decode(decodeBase32(encrypted));
          break;
        }
        default: {
          throw new Error("Algorithm not allowed in this context");
        }
      }
      decryptedPath.push(elem);
    }

    return decryptedPath;
  }

  async decryptPayload(
    identity: IdentityAddress,
    path: Path,
    payload: Uint8Array | AsyncIterable<Uint8Array>,
  ) {
    if (path[0] == "encryption") {
      return payload;
    }

    const elemSettings = await this.getEncryptionSettingsForPath(identity, path, "payload");

    switch(elemSettings.algorithm) {
      case "none": {
        return payload;
      }
      case "base32": {
        const bytes = payload instanceof Uint8Array
        ? payload
        : new Uint8Array(await Willow.collectUint8Arrays(payload));
        return decodeBase32(new TextDecoder().decode(bytes));
      }
      case "wxchacha20poly1305": {
        const key = await this.deriveKey(
          identity,
          path,
          elemSettings,
        )
        const bytes = payload instanceof Uint8Array
        ? payload
        : new Uint8Array(await Willow.collectUint8Arrays(payload));
        return wxchacha20poly1305(key).decrypt(bytes);
      }
      default: {
        throw new Error("Algorithm not allowed in this context");
      }
    }
  }

  async decryptDocument(
    document: Document,
  ): Promise<Document> {
    const decryptedPath = await this.decryptPath(
      document.identity,
      document.path,
    )

    let decryptedPayload: Willow.Payload | undefined;
    if (document.payload) {
      const decryptedMaybeBytes = await this.decryptPayload(
        document.identity,
        decryptedPath,
        await document.payload.bytes(),
      );
      const decryptedBytes = decryptedMaybeBytes instanceof Uint8Array
      ? decryptedMaybeBytes
      : new Uint8Array(await Willow.collectUint8Arrays(decryptedMaybeBytes));
      decryptedPayload = this.getPayload(decryptedBytes)
    } else {
      decryptedPayload = document.payload;
    }

    return {
      share: document.share,
      identity: document.identity,
      path: decryptedPath,
      timestamp: document.timestamp,
      size: document.size,
      digest: document.digest, // This is of the encrypted version. Problem? What's this field actually needed by?,
      signedBy: document.signedBy,
      payload: decryptedPayload,
    }
  }

  async set(
    input: {
      path: Path;
      identity: IdentityAddress;
      payload: Uint8Array | AsyncIterable<Uint8Array>;
      timestamp?: bigint;
    },
    authorisation: { capability: Capability; secret: Uint8Array },
    permitPruning?: boolean,
  ): Promise<SetEvent> {

    return this.baseStore.set({
      path: await this.encryptPath(input.identity, input.path),
      identity: input.identity,
      payload: await this.encryptPayload(input.identity, input.path, input.payload),
      timestamp: input.timestamp,
    }, authorisation, permitPruning)
  }

  async clear(
    identity: IdentityAddress,
    path: Path,
    authorisation: { capability: Capability; secret: Uint8Array },
  ): Promise<Document | ValidationError> {
    return this.clear(
      identity,
      await this.encryptPath(identity, path),
      authorisation,
    );
  }

  async get(
    identity: IdentityAddress,
    path: Path,
  ): Promise<Document | undefined | ValidationError> {
    const document = await this.baseStore.get(identity, await this.encryptPath(identity, path))
    if (document && "share" in document) {
      return this.decryptDocument(document)
    }
    return document;
  }

  async *documents(options?: {
    order?: "path" | "identity" | "timestamp";
    descending?: boolean;
  }): AsyncIterable<Document> {
    for await (const doc of this.baseStore.documents(options)) {
      yield await this.decryptDocument(doc);
    }
  }

  async latestDocAtPath(
    path: Path,
  ): Promise<Document | undefined | ValidationError> {
    // TODO this might be tricky...
    return;
  }

  async *documentsAtPath(
    path: Path,
  ): AsyncIterable<Document> {
    // TODO: Same as above, hmmmmm
  }

  async *queryDocs(query: Query): AsyncIterable<Document> {
    // TODO
  }

  async *queryPaths(query: Query): AsyncIterable<Path> {
    // TODO
  }

  async *queryIdentities(query: Query): AsyncIterable<IdentityAddress> {
    // TODO
  }

  // Hacky copy
  private getPayload(bytes: Uint8Array): Willow.Payload {
    return {
      bytes: (offset) => {
        if (!offset) {
          return Promise.resolve(bytes);
        }

        return Promise.resolve(
          new Uint8Array(
            bytes.slice(offset),
          ),
        );
      },

      // Need to do this for Node's sake.
      stream: (offset) => {
        if (!offset) {
          return Promise.resolve(
            new Blob([bytes.buffer]).stream() as unknown as ReadableStream<
              Uint8Array
            >,
          );
        }

        return Promise.resolve(new Blob([bytes.subarray(offset).buffer])
          .stream() as unknown as ReadableStream<
            Uint8Array
          >);
      },
      length: () => Promise.resolve(BigInt(bytes.byteLength)),
    };
  }
}
