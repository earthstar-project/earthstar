import { fast_deep_equal as isEqual, fast_json_stable_stringify as stringify } from "../../deps.ts";

import { AuthorKeypair, Doc, DocToSet, Path } from "../util/doc-types.ts";
import { ReplicaIsClosedError } from "../util/errors.ts";

import { cleanUpQuery, docMatchesFilter } from "../query/query.ts";
import { QueryFollower } from "../query-follower/query-follower.ts";
import { Query } from "../query/query-types.ts";
import { IReplica, LiveQueryEvent } from "./replica-types.ts";

//================================================================================

// Lifted from ReplicaDriverMemory
// Slightly different in that it does not check if doc matches the filter,
// as this has been done beforehand by now.
function sortAndLimit(query: Query, docs: Doc[]) {
    const filteredDocs: Doc[] = [];

    for (const doc of docs) {
        if (query.orderBy === "path ASC") {
            if (query.startAfter !== undefined) {
                if (
                    query.startAfter.path !== undefined &&
                    doc.path <= query.startAfter.path
                ) {
                    continue;
                }
                // doc.path is now > startAfter.path
            }
        }
        if (query.orderBy === "path DESC") {
            if (query.startAfter !== undefined) {
                if (
                    query.startAfter.path !== undefined &&
                    doc.path >= query.startAfter.path
                ) {
                    continue;
                }
                // doc.path is now < startAfter.path (we're descending)
            }
        }
        if (query.orderBy === "localIndex ASC") {
            if (query.startAfter !== undefined) {
                if (
                    query.startAfter.localIndex !== undefined &&
                    (doc._localIndex || 0) <= query.startAfter.localIndex
                ) {
                    continue;
                }
                // doc.path is now > startAfter.localIndex
            }
        }
        if (query.orderBy === "localIndex DESC") {
            if (query.startAfter !== undefined) {
                if (
                    query.startAfter.localIndex !== undefined &&
                    (doc._localIndex || 0) >= query.startAfter.localIndex
                ) {
                    continue;
                }
                // doc.path is now < startAfter.localIndex (we're descending)
            }
        }

        // finally, here's a doc we want
        filteredDocs.push(doc);

        // stop when hitting limit
        if (query.limit !== undefined && filteredDocs.length >= query.limit) {
            break;
        }
    }

    return filteredDocs;
}

/** A cached, synchronous interface to a replica, useful for reactive abstractions. Always returns results from its cache, and proxies the query to the backing replica in case of a cache miss.
 * ```
 * const cache = new ReplicaCache(myReplica);
 * const pngQuery = { filter: { pathEndsWith: ".png" } };
 * let pngDocs = cache.queryDocs(pngQuery);
 * cache.onCacheUpdate(() => {
 *    pngDocs = cache.queryDocs(pngQuery);
 * });
 * ```
 */
export class ReplicaCache {
    _replica: IReplica;

    _docCache = new Map<
        string,
        { docs: Doc[]; follower: QueryFollower; expires: number }
    >();

    _timeToLive: number;

    _onCacheUpdatedCallbacks = new Set<() => void | (() => Promise<void>)>();

    /**
     * Create a new ReplicaCache.
     * @param timeToLive - The number of milliseconds a cached document is considered valid for.
     */
    constructor(replica: IReplica, timeToLive?: number) {
        this._replica = replica;
        this._timeToLive = timeToLive || 1000;
    }

    // SET - just pass along to the backing storage

    /** Add a new document directly to the backing replica. */
    set(keypair: AuthorKeypair, docToSet: DocToSet) {
        return this._replica.set(keypair, docToSet);
    }

    // GET

    /** Fetch all versions of all docs from the cache. Returns an empty array in case of a cache miss, and queries the backing replica. */
    getAllDocs(): Doc[] {
        if (this._replica.isClosed()) {
            throw new ReplicaIsClosedError();
        }
        return this.queryDocs({
            historyMode: "all",
            orderBy: "path DESC",
        });
    }

    /** Fetch latest versions of all docs from the cache. Returns an empty array in case of a cache miss, and queries the backing replica. */
    getLatestDocs(): Doc[] {
        if (this._replica.isClosed()) {
            throw new ReplicaIsClosedError();
        }
        return this.queryDocs({
            historyMode: "latest",
            orderBy: "path DESC",
        });
    }

    /** Fetch all versions of all docs from a certain path from the cache. Returns an empty array in case of a cache miss, and queries the backing replica. */
    getAllDocsAtPath(path: Path): Doc[] {
        if (this._replica.isClosed()) {
            throw new ReplicaIsClosedError();
        }
        return this.queryDocs({
            historyMode: "all",
            orderBy: "path DESC",
            filter: { path: path },
        });
    }

    /** Fetch latest version of a doc at a path from the cache. Returns an empty array in case of a cache miss, and queries the backing replica. */
    getLatestDocAtPath(path: Path): Doc | undefined {
        if (this._replica.isClosed()) {
            throw new ReplicaIsClosedError();
        }
        const docs = this.queryDocs({
            historyMode: "latest",
            orderBy: "path DESC",
            filter: { path: path },
        });
        if (docs.length === 0) {
            return undefined;
        }
        return docs[0];
    }

    /** Fetch docs matching a query from the cache. Returns an empty array in case of a cache miss, and queries the backing replica. */
    queryDocs(query: Query = {}): Doc[] {
        // make a deterministic string out of the query
        const cleanUpQueryResult = cleanUpQuery(query);

        if (cleanUpQueryResult.willMatch === "nothing") {
            return [];
        }

        const queryString = stringify(cleanUpQueryResult.query);

        // Check if the cache has anything from this
        // and if so, return it.
        const cachedResult = this._docCache.get(queryString);

        if (cachedResult) {
            // Query the storage, set the eventual result in the cache.
            this._replica.queryDocs(query).then((docs) => {
                this._docCache.set(queryString, { ...cachedResult, docs });
            });

            if (Date.now() > cachedResult.expires) {
                this._replica.queryDocs(query).then((docs) => {
                    this._docCache.set(queryString, {
                        follower,
                        docs,
                        expires: Date.now() + this._timeToLive,
                    });

                    this._fireOnCacheUpdateds();
                });
            }

            return cachedResult.docs;
        }

        const follower = new QueryFollower(
            this._replica,
            { ...query, historyMode: "all", orderBy: "localIndex ASC" },
        );

        follower.bus.on((event: LiveQueryEvent) => {
            if (event.kind === "existing" || event.kind === "success") {
                this._updateCache(event.doc);
            }
        });

        // Add an entry to the cache.
        this._docCache.set(queryString, {
            docs: [],
            follower,
            expires: Date.now() + this._timeToLive,
        });

        // Hatch the follower.
        follower.hatch();

        this._replica.queryDocs(query).then((docs) => {
            this._docCache.set(queryString, {
                follower,
                docs,
                expires: Date.now() + this._timeToLive,
            });

            this._fireOnCacheUpdateds();
        });

        // Return an empty result for the moment.
        return [];
    }

    // OVERWRITE

    // We just call the backing storage's implementation
    // A user calling this method probably wants to be sure
    // that their docs are _really_ deleted,
    // so we don't do a quick and dirty version in the cache here.

    /** Call this method on the backing replica. */
    overwriteAllDocsByAuthor(keypair: AuthorKeypair) {
        return this._replica.overwriteAllDocsByAuthor(keypair);
    }

    // CACHE

    // Update cache entries as best as we can until results from the backing storage arrive.
    _updateCache(doc: Doc): void {
        this._docCache.forEach((entry, key) => {
            const query: Query = JSON.parse(key);

            /*
      IF at least one document with same path is present
        AND historymode is latest
          AND doc has different author
            REPLACE
          OR doc has same author
            AND is different otherwise
              REPLACE
            OR is the same
              NOOP
        OR history mode is all
          AND doc has same author
            REPLACE one with same a
          OR doc has different author
            REPLACE


      OR zero documents with the same path
        AND query has a filter
          AND doc matches filter
            APPEND
          OR does not match filter
            NOOP
        OR query has no filter
          APPEND
     */

            const appendDoc = () => {
                const nextDocs = [...entry.docs, doc];
                this._docCache.set(key, {
                    ...entry,
                    docs: sortAndLimit(query, nextDocs),
                });
                this._fireOnCacheUpdateds();
            };

            const replaceDoc = ({ exact }: { exact: boolean }) => {
                const nextDocs = entry.docs.map((existingDoc) => {
                    if (
                        exact &&
                        existingDoc.path === doc.path &&
                        existingDoc.author === doc.author
                    ) {
                        return doc;
                    } else if (!exact && existingDoc.path === doc.path) {
                        return doc;
                    }

                    return existingDoc;
                });

                this._docCache.set(key, {
                    ...entry,
                    docs: sortAndLimit(query, nextDocs),
                });
                this._fireOnCacheUpdateds();
            };

            const documentsWithSamePath = entry.docs.filter(
                (existingDoc) => existingDoc.path === doc.path,
            );

            const documentsWithSamePathAndAuthor = entry.docs.filter(
                (existingDoc) =>
                    existingDoc.path === doc.path &&
                    existingDoc.author === doc.author,
            );

            if (documentsWithSamePath.length === 0) {
                if (
                    (query.filter && docMatchesFilter(doc, query.filter)) ||
                    !query.filter
                ) {
                    appendDoc();
                }
                return;
            }

            const historyMode = query.historyMode || "latest";

            if (historyMode === "all") {
                if (documentsWithSamePathAndAuthor.length === 0) {
                    appendDoc();
                    return;
                }

                replaceDoc({ exact: true });
                return;
            }

            const latestDoc = documentsWithSamePath[0];

            // console.log({latestDoc, doc})

            const docIsDifferent = doc.author !== latestDoc?.author ||
                !isEqual(doc, latestDoc);

            const docIsLater = doc.timestamp > latestDoc.timestamp;

            if (docIsDifferent && docIsLater) {
                replaceDoc({ exact: false });
                return;
            }
        });
    }

    // SUBSCRIBE

    _fireOnCacheUpdateds() {
        return Promise.all(
            Array.from(this._onCacheUpdatedCallbacks.values()).map(
                (callback) => {
                    return callback();
                },
            ),
        );
    }

    /** Subscribes to the cache, calling a callback when previously returned results can be considered stale. Returns a function for unsubscribing. */
    onCacheUpdated(callback: () => void | (() => Promise<void>)): () => void {
        this._onCacheUpdatedCallbacks.add(callback);

        return () => {
            this._onCacheUpdatedCallbacks.delete(callback);
        };
    }
}
