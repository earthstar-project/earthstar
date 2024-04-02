import { Willow } from "../../deps.ts";
import { ShareAddress } from "../crypto/types.ts";
import {
  authorisationScheme,
  fingerprintScheme,
  namespaceScheme,
  pathScheme,
  payloadScheme,
  subspaceScheme,
} from "../parameters/schemes.ts";

export class Store extends EventTarget {
  constructor(namespace: ShareAddress) {
    super();

    const willowStore = new Willow.Store({
      namespace,
      schemes: {
        namespace: namespaceScheme,
        subspace: subspaceScheme,
        path: pathScheme,
        payload: payloadScheme,
        fingerprint: fingerprintScheme,
        authorisation: authorisationScheme,
      },
    });
  }

  set() {
  }

  ingestEntry() {
  }

  ingestPayload() {
  }

  clear() {
  }

  get() {
  }

  async *query() {
  }

  async *queryPaths() {
  }

  async *queryIdentities() {
  }
}
