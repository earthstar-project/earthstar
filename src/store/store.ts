import {
  OPEN_END,
  Path as WillowPath,
  successorPath,
  Willow,
} from "../../deps.ts";
import { AuthorisationToken, Capability } from "../auth/auth.ts";
import { checkIdentityIsValid } from "../core_validators/addresses.ts";
import { IdentityAddress, ShareAddress } from "../crypto/types.ts";
import {
  authorisationScheme,
  fingerprintScheme,
  namespaceScheme,
  pathScheme,
  payloadScheme,
  subspaceScheme,
} from "../parameters/schemes.ts";
import { entryToDocument } from "../util/documents.ts";
import { EarthstarError, isErr, ValidationError } from "../util/errors.ts";
import { earthstarToWillowPath, willowToEarthstarPath } from "../util/path.ts";
import { relayWillowEvents } from "./events.ts";
import { Document, Query, SetEvent, StoreDriverOpts } from "./types.ts";
import { queryToWillowQueryParams } from "./util.ts";
import { Path } from "./types.ts";

/** A store for reading, writing, and querying documents from a corresponding share.
 *
 * Which documents a store has depends on many factors: what has been written to it locally, the other stores you have synced to, and the capabilities granted during sync.
 *
 * ```ts
 * const store = new Store("+gardening.bhynoq5vqfpysmi2i7zilhdnynfsuq5wddus5sfgce24z53a2f6da");
 *
 * await store.set({
 *   identity: "@suzy.b3kxcquuxuckzqcovqhtk32ncj6aiixk46zg6pkfocdkhpst4selq",
 *   path: ['greetings', 'earth'],
 *   payload: new TextEncoder().encode("Hello world!"),
 * });
 *
 * const doc = await store.get({
 *   identity: "@suzy.b3kxcquuxuckzqcovqhtk32ncj6aiixk46zg6pkfocdkhpst4selq",
 *   path: ['greetings', 'earth'],
 * });
 * ```
 */
export class Store extends EventTarget {
  /** The underlying Willow `Store`, made accessible for advanced usage and shenanigans. */
  willow: Willow.Store<
    ShareAddress,
    IdentityAddress,
    ArrayBuffer,
    {
      cap: Capability;
      receiverSecret: Uint8Array;
    },
    AuthorisationToken,
    ArrayBuffer
  >;

  constructor(
    namespace: ShareAddress,
    drivers?: StoreDriverOpts,
  ) {
    super();

    // If drivers are specified, use those, otherwise always use in-memory drivers (the default in willow-js).
    const driversToUse = drivers && drivers !== "memory" ? drivers : {};

    this.willow = new Willow.Store({
      namespace,
      schemes: {
        namespace: namespaceScheme,
        subspace: subspaceScheme,
        path: pathScheme,
        payload: payloadScheme,
        fingerprint: fingerprintScheme,
        authorisation: authorisationScheme,
      },
      ...driversToUse,
    });

    relayWillowEvents(this, this.willow);
  }

  /** Create (or update) a document for a given identity and path.
   *
   * ```ts
   * await store.set({
   *   identity: "@suzy.b3kxcquuxuckzqcovqhtk32ncj6aiixk46zg6pkfocdkhpst4selq",
   *   path: ['greetings', 'earth'],
   *   payload: new TextEncoder().encode("Hello world!"),
   * });
   * ```
   */
  async set(
    input: {
      path: Path;
      identity: IdentityAddress;
      payload: Uint8Array | AsyncIterable<Uint8Array>;
      timestamp?: bigint;
    },
    // TODO: When we have the capability API, automatically find the right authorisation to use.
    authorisation: { capability: Capability; secret: Uint8Array },
    /** Whether to permit the deletion of documents via prefix pruning. Disabled by default. */
    permitPruning?: boolean,
  ): Promise<SetEvent> {
    const isIdentityValid = checkIdentityIsValid(input.identity);

    if (isErr(isIdentityValid)) {
      return {
        kind: "failure",
        reason: "invalid_entry",
        message: isIdentityValid.message,
        err: isIdentityValid,
      };
    }

    const willowPath = earthstarToWillowPath(input.path);

    if (isErr(willowPath)) {
      return {
        kind: "failure",
        reason: "invalid_entry",
        message: willowPath.message,
        err: willowPath,
      };
    }

    if (!permitPruning) {
      const prunableEntries = await this.willow.prunableEntries({
        path: willowPath,
        subspace: input.identity,
        timestamp: input.timestamp || BigInt(Date.now() * 1000),
      });

      if (prunableEntries.length > 0) {
        const preservedDocuments = [];

        for (const { entry } of prunableEntries) {
          const payload = await this.willow.getPayload(entry);
          const authToken = await this.willow.getAuthToken(entry);

          if (!authToken) {
            throw new EarthstarError(
              "Could not retrieve authorisation token for a stored entry. Seems bad.",
            );
          }

          preservedDocuments.push(entryToDocument(entry, payload, authToken));
        }

        return {
          kind: "pruning_prevented",
          preservedDocuments,
        };
      }
    }

    const result = await this.willow.set({
      path: willowPath,
      subspace: input.identity,
      payload: input.payload,
      timestamp: input.timestamp,
    }, {
      cap: authorisation.capability,
      receiverSecret: authorisation.secret,
    });

    if (result.kind !== "success") {
      return result;
    }

    const payload = await this.willow.getPayload(result.entry);

    if (!payload) {
      throw new EarthstarError(
        "Couldn't retrieve a payload for an entry we just created. Seems bad.",
      );
    }

    const prunedPaths: Path[] = [];

    for (const entry of result.pruned) {
      const path = willowToEarthstarPath(entry.path);

      prunedPaths.push(path);
    }

    return {
      kind: "success",
      document: entryToDocument(result.entry, payload, result.authToken),
      pruned: prunedPaths,
    };
  }

  /** Clear the data of a document at a given identity and path.
   *
   * **This only deletes the document's payload, not the document itself.** To delete a document entirely, you must use prefix pruning.
   *
   * ```ts
   * await store.clear({
   *   identity: "@suzy.b3kxcquuxuckzqcovqhtk32ncj6aiixk46zg6pkfocdkhpst4selq",
   *   path: ['greetings', 'earth'],
   * });
   * ```
   */
  async clear(
    identity: IdentityAddress,
    path: Path,
    // TODO: When we have the capability API, automatically find the right authorisation to use.
    authorisation: { capability: Capability; secret: Uint8Array },
  ): Promise<Document | ValidationError> {
    const existing = await this.get(identity, path);

    if (isErr(existing)) {
      return existing;
    }

    if (existing === undefined) {
      return new ValidationError(
        "Cannot clear a document which does not yet exist.",
      );
    }

    const result = await this.willow.set({
      path: earthstarToWillowPath(path) as WillowPath, // Validated already by this.get.
      subspace: identity,
      payload: new Uint8Array(),
      timestamp: existing.timestamp + 1n,
    }, {
      cap: authorisation.capability,
      receiverSecret: authorisation.secret,
    });

    if (result.kind === "failure") {
      return new ValidationError(`Could not clear document: ${result.message}`);
    }

    if (result.kind === "no_op") {
      return new ValidationError(`Could not clear document: ${result.reason}`);
    }

    const payload = await this.willow.getPayload(result.entry);

    if (!payload) {
      throw new EarthstarError(
        "Couldn't retrieve a payload for an entry we just created. Seems bad.",
      );
    }

    return entryToDocument(result.entry, payload, result.authToken);
  }

  /** Retrieve a single document by an identity and path.
   *
   * ```ts
   * const displayNameDoc = await store.get(
   *  "@suzy.b3kxcquuxuckzqcovqhtk32ncj6aiixk46zg6pkfocdkhpst4selq",
   *  ["about", "displayName"]
   * )
   * ```
   */
  async get(
    identity: IdentityAddress,
    path: Path,
  ): Promise<Document | undefined | ValidationError> {
    const isIdentityValid = checkIdentityIsValid(identity);

    if (isErr(isIdentityValid)) {
      return isIdentityValid;
    }

    const willowPath = earthstarToWillowPath(path);

    if (isErr(willowPath)) {
      return willowPath;
    }

    const query = this.willow.queryRange(
      {
        pathRange: {
          start: willowPath,
          end: successorPath(willowPath, pathScheme) || OPEN_END,
        },
        subspaceRange: {
          start: identity,
          end: subspaceScheme.successor(identity) || OPEN_END,
        },
        timeRange: {
          start: 0n,
          end: OPEN_END,
        },
      },
      "newest",
    );

    for await (const [entry, payload, authToken] of query) {
      return entryToDocument(entry, payload, authToken);
    }

    return undefined;
  }

  /** Iterate through all documents in this store.
   *
   * ```ts
   * for await (const doc of store.documents({ order: "path" })) {
   *   console.log(doc);
   * }
   * ```
   */
  async *documents(options?: {
    /** The order in which documents will be returned. Uses `path` by default.
     *
     * - `path` - path first, then timestamp, then identity.
     * - `timestamp` - timestamp first, then identity, then path.
     * - `identity` - identity first, then path, then timestamp.
     */
    order?: "path" | "identity" | "timestamp";
    /** Whether to return results in descending order. 'false' by default. */
    descending?: boolean;
  }): AsyncIterable<Document> {
    const query = this.queryDocs({
      order: options?.order,
      descending: options?.descending,
    });

    for await (const doc of query) {
      yield doc;
    }
  }

  /** Retrieve the most recently written document at a path, regardless of the identity associated with it.
   *
   * ```ts
   * const latest = await store.latestDocAtPath(["weather"]);
   * ```
   */
  async latestDocAtPath(
    path: Path,
  ): Promise<Document | undefined | ValidationError> {
    const willowPath = earthstarToWillowPath(path);

    if (isErr(willowPath)) {
      return willowPath;
    }

    const query = this.willow.queryRange(
      {
        pathRange: {
          start: willowPath,
          end: successorPath(willowPath, pathScheme) || OPEN_END,
        },
        subspaceRange: {
          start: subspaceScheme.minimalSubspaceId,
          end: OPEN_END,
        },
        timeRange: {
          start: 0n,
          end: OPEN_END,
        },
      },
      "newest",
    );

    for await (const [entry, payload, authToken] of query) {
      return entryToDocument(entry, payload, authToken);
    }

    return undefined;
  }

  /** Iterate through all documents at a given path, sorted newest document first.
   *
   * ```ts
   * for await (const avatarDoc of store.documentsAtPath(["about", "avatar"])) {
   *    console.log(avatarDoc);
   * }
   * ```
   */
  async *documentsAtPath(
    path: Path,
  ): AsyncIterable<Document> {
    const willowPath = earthstarToWillowPath(path);

    if (isErr(willowPath)) {
      throw willowPath;
    }

    const query = this.willow.queryRange(
      {
        pathRange: {
          start: willowPath,
          end: successorPath(willowPath, pathScheme) || OPEN_END,
        },
        subspaceRange: {
          start: subspaceScheme.minimalSubspaceId,
          end: OPEN_END,
        },
        timeRange: {
          start: 0n,
          end: OPEN_END,
        },
      },
      "newest",
    );

    for await (const [entry, payload, authToken] of query) {
      yield entryToDocument(entry, payload, authToken);
    }
  }

  /** Iterate through documents in the store selected by a query.
   *
   * ```ts
   * for await (const recentBlogDoc of store.queryDocs({
   *  pathPrefix: ["blog"],
   *  timestampGte: lastWeek,
   *  limit: 10
   * }) {
   *    console.log(doc);
   * }
   * ```
   */
  async *queryDocs(query: Query): AsyncIterable<Document> {
    const willowQueryParams = queryToWillowQueryParams(query);

    if (isErr(willowQueryParams)) {
      return willowQueryParams;
    }

    const willowQuery = this.willow.query(
      willowQueryParams.areaOfInterest,
      willowQueryParams.order,
      willowQueryParams.reverse,
    );

    for await (const [entry, payload, authToken] of willowQuery) {
      yield entryToDocument(entry, payload, authToken);
    }
  }

  /** Iterate through the paths of documents written to the store and selected by a query.
   *
   * ```ts
   * for await (const suzyPath of store.queryPaths({
   *  identity: "@suzy.b3kxcquuxuckzqcovqhtk32ncj6aiixk46zg6pkfocdkhpst4selq",
   * }) {
   *    console.log(suzyPath);
   * }
   * ```
   */
  async *queryPaths(query: Query): AsyncIterable<Path> {
    const willowQueryParams = queryToWillowQueryParams(query);

    if (isErr(willowQueryParams)) {
      return willowQueryParams;
    }

    const willowQuery = this.willow.query(
      willowQueryParams.areaOfInterest,
      willowQueryParams.order,
      willowQueryParams.reverse,
    );

    const emittedSet = new Set<string>();

    for await (const [entry] of willowQuery) {
      const path = willowToEarthstarPath(entry.path);
      const joined = path.join("/");

      if (emittedSet.has(joined)) {
        continue;
      }

      emittedSet.add(joined);
      yield path;
    }
  }

  /** Iterate through identities which have written to the store and selected by a query.
   *
   * ```ts
   * for await (const inactiveIdentity of store.queryPaths({
   *  timestampLt: sixMonthsAgo
   * }) {
   *    console.log(inactiveIdentity);
   * }
   * ```
   */
  async *queryIdentities(query: Query): AsyncIterable<IdentityAddress> {
    const willowQueryParams = queryToWillowQueryParams(query);

    if (isErr(willowQueryParams)) {
      return willowQueryParams;
    }

    const willowQuery = this.willow.query(
      willowQueryParams.areaOfInterest,
      willowQueryParams.order,
      willowQueryParams.reverse,
    );

    const emittedSet = new Set<string>();

    for await (const [entry] of willowQuery) {
      if (emittedSet.has(entry.subspaceId)) {
        continue;
      }

      emittedSet.add(entry.subspaceId);
      yield entry.subspaceId;
    }
  }
}
