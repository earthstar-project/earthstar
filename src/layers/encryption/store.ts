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

export type EncryptionRule = {
  // from: TODO
  // to: TODO
  key: string;
  recursive: boolean;
  type: 'base64' | 'none' | 'path-based' | 'per-key' | 'static';
}

export type EncryptionSetting = {
  rules: EncryptionRule[]; // Isn't really needed without from/to support tbh
};

/** A layer for implementing the /encryption/ spec on an underlying Store
 *
 * The interface for this is the same as for Store
 *
 * This doesn't allow for encrypting the payload of the empty path - as the settings are for the next level down
 * In practice.. The empty path, if set, overwrites the entire space - so isn't likely to actually be used for anything
 */
export class Store {
  /** The underlying Earthstar `Store`, made accessible for advanced usage and shenanigans. */
  baseStore: BaseStore;

  constructor(
    store: BaseStore,
  ) {
    this.baseStore = store;
  }

  // TODO: Watch events on underlying store, and update a cached encryption settings type thing
  // when relevant changes happen
  // This implementation is pretty meh without that, but eh, PoC.
  async getAllEncryptionSettings(
    identity: IdentityAddress,
  ) {
    const documents = await Array.fromAsync(this.baseStore.queryDocs({
      identity: identity,
      pathPrefix: ["encryption", "1.0"]
    }));

    return documents;
  }

  async getEncryptionSettingsForPath(
    identity: IdentityAddress,
    path: Path,
    type: 'path' | 'payload'
  ) {
    console.log(`getEncryptionSettingsForPath: ${identity}/${path}: ${type}`)

    const desiredPath = path.slice(0, -1); // The settings for /a/b/c live at /a/b/{type}.yaml

    const documents = await this.getAllEncryptionSettings(identity);

    let foundPath: Path = [];
    let settings: EncryptionSetting = {
      rules: [{
        key: '',
        recursive: true,
        type: 'none',
      }],
    }

    for (const doc of documents) {
      if (!doc.path.slice(-1)[0].endsWith(`${type}.yaml`)) {
        // Wrong sort of document, ignore
        continue;
      }

      const docPath = doc.path.slice(2, -1); // Remove encryption/1.0 and path.yaml or payload.yaml
      if (!doc.payload) {
        continue;
      }
      const bytes = await doc.payload.bytes();
      const docSettings = parse(bytesToString(bytes)) as EncryptionSetting;

      if (!desiredPath.join("/").startsWith(docPath.join("/"))) {
        // This document does not have a path that's a prefix of the one we're interested in, so the settings won't apply
        continue;
      }

      if (!docSettings.rules) {
        console.log(`Invalid encryption document found at ${identity}/${doc.path}`)
        continue;
      }

      if (!docSettings.rules[0].recursive && desiredPath.join("/") != doc.path.join("/")) {
        // We're not at that specific level of the path and the settings aren't recursive, so ignore
        continue;
      }

      if (docPath.length >= foundPath.length) {
        // This document applies, and is more specific than the previous one we've found
        foundPath = docPath;

        settings = docSettings;
      }
    }

    return settings;
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
      switch(elemSettings.rules[0].type) {
        case "none": {
          elem = plain;
          break;
        }
        case "base64": {
          elem = btoa(plain);
          break;
        }
        case "static": {
          // FIXME implement algorithm
          elem = "FIXME";
          break;
        }
        default: {
          // FIXME panic
          elem = "FIXME";
          break;
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

    switch(elemSettings.rules[0].type) {
      case "none": {
        return payload;
      }
      case "base64": {
        const bytes = payload instanceof Uint8Array
        ? payload
        : new Uint8Array(await Willow.collectUint8Arrays(payload));
        return new TextEncoder().encode(btoa(String.fromCharCode(...bytes)));
      }
      case "static": {
        // FIXME implement algorithm
      }
      default: {
        // FIXME panic
      }
    }

    // FIXME hack
    return payload;
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
      switch(elemSettings.rules[0].type) {
        case "none": {
          elem = encrypted;
          break;
        }
        case "base64": {
          elem = atob(encrypted);
          break;
        }
        case "static": {
          // FIXME implement algorithm
          elem = "FIXME";
          break;
        }
        default: {
          // FIXME panic
          elem = "FIXME";
          break;
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

    switch(elemSettings.rules[0].type) {
      case "none": {
        return payload;
      }
      case "base64": {
        const bytes = payload instanceof Uint8Array
        ? payload
        : new Uint8Array(await Willow.collectUint8Arrays(payload));
        const ret = new TextEncoder().encode(atob(new TextDecoder().decode(bytes)));
        return ret;
      }
      case "static": {
        // FIXME implement algorithm
      }
      default: {
        // FIXME panic
      }
    }

    // FIXME hack
    return payload;
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
