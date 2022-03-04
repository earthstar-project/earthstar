import { fast_deep_equal as isEqual, fast_json_stable_stringify as stringify } from "../../deps.ts";

import { AuthorKeypair, Doc, DocToSet, Path } from "../util/doc-types.ts";
import { ReplicaCacheIsClosedError, ReplicaIsClosedError } from "../util/errors.ts";

import { cleanUpQuery, docMatchesFilter } from "../query/query.ts";
import { QueryFollower } from "../query-follower/query-follower.ts";
import { Query } from "../query/query-types.ts";
import { IReplica, LiveQueryEvent } from "./replica-types.ts";

import { Logger } from "../util/log.ts";

const logger = new Logger("replica-cache", "green");

//================================================================================

function justLocalIndex({ _localIndex }: Doc) {
    return _localIndex;
}

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

type CacheEntry = { docs: Doc[]; follower: QueryFollower; expires: number };

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
    version = 0;

    _replica: IReplica;

    _docCache = new Map<
        string,
        CacheEntry
    >();

    _timeToLive: number;

    _onCacheUpdatedCallbacks = new Set<(entry: string) => void>();

    _isClosed = false;

    /**
     * Create a new ReplicaCache.
     * @param timeToLive - The number of milliseconds a cached document is considered valid for.
     */
    constructor(replica: IReplica, timeToLive?: number) {
        this._replica = replica;
        this._timeToLive = timeToLive || 1000;
    }

    async close() {
        if (this._isClosed) throw new ReplicaCacheIsClosedError();
        this._isClosed = true;

        await Promise.all(
            Array.from(this._docCache.values()).map((entry) => entry.follower.close),
        );

        this._docCache.clear();
    }

    isClosed() {
        return this._isClosed;
    }

    // SET - just pass along to the backing storage

    /** Add a new document directly to the backing replica. */
    set(keypair: AuthorKeypair, docToSet: DocToSet) {
        if (this._isClosed) throw new ReplicaCacheIsClosedError();

        return this._replica.set(keypair, docToSet);
    }

    // GET

    /** Fetch all versions of all docs from the cache. Returns an empty array in case of a cache miss, and queries the backing replica. */
    getAllDocs(): Doc[] {
        if (this._isClosed) throw new ReplicaCacheIsClosedError();
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
        if (this._isClosed) throw new ReplicaCacheIsClosedError();
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
        if (this._isClosed) throw new ReplicaCacheIsClosedError();
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
        if (this._isClosed) throw new ReplicaCacheIsClosedError();
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
        if (this._isClosed) throw new ReplicaCacheIsClosedError();
        if (this._replica.isClosed()) {
            throw new ReplicaIsClosedError();
        }
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
            // If the result has expired, query the storage again.
            if (Date.now() > cachedResult.expires) {
                this._replica.queryDocs(query).then((docs) => {
                    const localIndexes = docs.map(justLocalIndex).sort();
                    const cacheLocalIndexes = cachedResult.docs.map(justLocalIndex).sort();

                    // Return early if the new result is the same as the cached result.
                    // (The sets of localIndexes should be identical if they're the same)
                    if (isEqual(localIndexes, cacheLocalIndexes)) {
                        return;
                    }

                    this._docCache.set(queryString, {
                        follower: cachedResult.follower,
                        docs,
                        expires: Date.now() + this._timeToLive,
                    });

                    logger.debug("Updated cache because result expired.");
                    this._fireOnCacheUpdateds(queryString);
                });
            }

            return cachedResult.docs;
        }

        // If there's no result, let's follow this query.
        const follower = new QueryFollower(
            this._replica,
            { ...query, historyMode: "all", orderBy: "localIndex ASC" },
        );

        follower.bus.on((event: LiveQueryEvent) => {
            if (event.kind === "existing" || event.kind === "success") {
                logger.debug({ doc: event.doc.path, queryString });
                this._updateCache(queryString, event.doc);
            }
        });

        // Hatch the follower.
        follower.hatch();

        // Set an empty entry in the cache so that calls which happen
        // while we wait for the first request to resolve don't queue up
        // more 'initial' queries.
        this._docCache.set(queryString, {
            follower,
            docs: [],
            expires: Date.now() + this._timeToLive,
        });

        // Query the storage, set the eventual result in the cache.
        this._replica.queryDocs(query).then((docs) => {
            this._docCache.set(queryString, {
                follower,
                docs,
                expires: Date.now() + this._timeToLive,
            });
            logger.debug("Updated cache with a new entry.");
            this._fireOnCacheUpdateds(queryString);
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
        if (this._isClosed) throw new ReplicaCacheIsClosedError();
        if (this._replica.isClosed()) {
            throw new ReplicaIsClosedError();
        }
        return this._replica.overwriteAllDocsByAuthor(keypair);
    }

    // CACHE

    // Update cache entries as best as we can until results from the backing storage arrive.
    _updateCache(key: string, doc: Doc): void {
        const entry = this._docCache.get(key);

        // This shouldn't happen really.
        if (!entry) {
            return;
        }

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
            this._fireOnCacheUpdateds(key);
        };

        const replaceDoc = ({ exact }: { exact: boolean }) => {
            const nextDocs = entry.docs.map((existingDoc) => {
                // If exact is true, we want to change the doc only if
                // The path and author are the same as the new doc.
                if (
                    exact &&
                    existingDoc.path === doc.path &&
                    existingDoc.author === doc.author
                ) {
                    return doc;
                    // If exact is false, we only need to check if the path is the same.
                } else if (!exact && existingDoc.path === doc.path) {
                    return doc;
                }

                return existingDoc;
            });

            this._docCache.set(key, { ...entry, docs: sortAndLimit(query, nextDocs) });
            this._fireOnCacheUpdateds(key);
        };

        const documentsWithSamePath = entry.docs.filter(
            (existingDoc) => existingDoc.path === doc.path,
        );

        const documentsWithSamePathAndAuthor = entry.docs.filter(
            (existingDoc) =>
                existingDoc.path === doc.path &&
                existingDoc.author === doc.author,
        );

        // No documents with the same path were found in the cache entry.
        // And the doc matches the query's filter (or lack thereof).
        // So append it to the entry's docs.
        if (documentsWithSamePath.length === 0) {
            if (
                (query.filter && docMatchesFilter(doc, query.filter)) ||
                !query.filter
            ) {
                logger.debug(
                    "Updated cache after appending a doc to a entry with matching filter.",
                );
                appendDoc();
            }
            return;
        }

        const historyMode = query.historyMode || "latest";

        // The history mode is 'all', so all versions are included
        if (historyMode === "all") {
            // A version by this author isn't present, so let's include it.
            if (documentsWithSamePathAndAuthor.length === 0) {
                logger.debug(
                    "Updated cache after appending a version of a doc to a historyMode: all query.",
                );
                appendDoc();
                return;
            }

            // A version by this author is present, so let's replace it.
            logger.debug(
                "Updated cache after replacing a version of a doc in a historyMode: all query.",
            );
            replaceDoc({ exact: true });
            return;
        }

        // The mode is 'latest', so there is only one doc with the same path.
        const latestDoc = documentsWithSamePath[0];

        // If the doc's author or content has changed.
        const docIsDifferent = doc.author !== latestDoc?.author ||
            !isEqual(doc, latestDoc);

        const docIsLater = doc.timestamp > latestDoc.timestamp;

        // The doc has changed or has a newer timestamp,
        // So replace it.
        if (docIsDifferent && docIsLater) {
            logger.debug("Updated cache after replacing a doc with its latest version.");
            replaceDoc({ exact: false });
            return;
        }
    }

    // SUBSCRIBE

    _fireOnCacheUpdateds(entry: string) {
        this.version++;

        this._onCacheUpdatedCallbacks.forEach((cb) => {
            cb(entry);
        });
    }

    /** Subscribes to the cache, calling a callback when previously returned results can be considered stale. Returns a function for unsubscribing. */
    onCacheUpdated(callback: (entryKey: string) => void): () => void {
        if (this._isClosed) throw new ReplicaCacheIsClosedError();
        if (this._replica.isClosed()) {
            throw new ReplicaIsClosedError();
        }

        this._onCacheUpdatedCallbacks.add(callback);

        return () => {
            this._onCacheUpdatedCallbacks.delete(callback);
        };
    }
}
