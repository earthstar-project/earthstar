import {
  fast_json_stable_stringify as stringify,
  shallowEqualArrays,
  shallowEqualObjects,
} from "../../deps.ts";
import {
  AuthorAddress,
  DocAttachment,
  DocBase,
  DocWithAttachment,
  Path,
} from "../util/doc-types.ts";
import {
  isErr,
  ReplicaCacheIsClosedError,
  ReplicaIsClosedError,
  ValidationError,
} from "../util/errors.ts";
import { cleanUpQuery, docMatchesFilter } from "../query/query.ts";
import { Query } from "../query/query-types.ts";
import {
  AttachmentIngestEvent,
  ExpireEvent,
  IngestEvent,
  IngestEventSuccess,
  QuerySourceEvent,
} from "./replica-types.ts";
import { Logger } from "../util/log.ts";
import { CallbackSink } from "../streams/stream_utils.ts";
import { Replica } from "./replica.ts";

import {
  DEFAULT_FORMAT,
  DEFAULT_FORMATS,
  getFormatLookup,
} from "../formats/util.ts";
import {
  DefaultFormat,
  DefaultFormats,
  FormatArg,
  FormatCredentialsType,
  FormatDocType,
  FormatInputType,
  FormatsArg,
} from "../formats/format_types.ts";

const logger = new Logger("replica-cache", "green");

//================================================================================

function justLocalIndex({ _localIndex }: DocBase<string>) {
  return _localIndex;
}

// Lifted from ReplicaDriverMemory
// Slightly different in that it does not check if doc matches the filter,
// as this has been done beforehand by now.
function sortAndLimit<DocType extends DocBase<string>>(
  query: Query<string[]>,
  docs: DocType[],
) {
  const filteredDocs: DocType[] = [];

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

type DocsCacheEntry<DocType> = {
  docs: DocType[];
  stream: ReadableStream<QuerySourceEvent<DocBase<string>>>;
  expires: number;
  close: () => void;
};

type AttachmentCacheEntry<F> = {
  expires: number;
  attachment: DocAttachment | undefined | ValidationError;
  format: FormatArg<F>;
};

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

  private replica: Replica;

  private docCache = new Map<
    string,
    DocsCacheEntry<DocBase<string>>
  >();

  private timeToLive: number;

  private onCacheUpdatedCallbacks = new Set<() => void>();

  private closed = false;

  private onFireCacheUpdatedsWrapper = (cb: () => void) => cb();

  /**
   * Create a new ReplicaCache.
   * @param timeToLive - The number of milliseconds a cached document is considered valid for.
   * @param onCacheUpdatedWrapper - A function which wraps the firing of all callbacks. Useful for libraries with batching abstractions.
   */
  constructor(
    replica: Replica,
    timeToLive?: number,
    onCacheUpdatedWrapper?: (cb: () => void) => void,
  ) {
    this.replica = replica;
    this.timeToLive = timeToLive || 1000;

    if (onCacheUpdatedWrapper) {
      this.onFireCacheUpdatedsWrapper = onCacheUpdatedWrapper;
    }

    const onReplicaEvent = this.onReplicaEvent.bind(this);

    this.replica.getEventStream("*").pipeTo(
      new WritableStream({
        write(event) {
          if (
            event.kind === "attachment_ingest" || event.kind === "success" ||
            event.kind === "expire"
          ) {
            onReplicaEvent(event);
          }
        },
      }),
    ).catch(() => {});
  }

  async close() {
    if (this.closed) throw new ReplicaCacheIsClosedError();
    this.closed = true;

    await Promise.all(
      Array.from(this.docCache.values()).map((entry) => entry.close()),
    );

    this.docCache.clear();

    this.onCacheUpdatedCallbacks.clear();
  }

  isClosed() {
    return this.closed;
  }

  // GET

  /** Fetch all versions of all docs from the cache. Returns an empty array in case of a cache miss, and queries the backing replica. */
  getAllDocs<F = DefaultFormats>(
    formats?: FormatsArg<F>,
  ): FormatDocType<F>[] {
    return this.queryDocs({
      historyMode: "all",
      orderBy: "path DESC",
    }, formats);
  }

  /** Fetch latest versions of all docs from the cache. Returns an empty array in case of a cache miss, and queries the backing replica. */
  getLatestDocs<F = DefaultFormats>(
    formats?: FormatsArg<F>,
  ): FormatDocType<F>[] {
    return this.queryDocs({
      historyMode: "latest",
      orderBy: "path DESC",
    }, formats);
  }

  /** Fetch all versions of all docs from a certain path from the cache. Returns an empty array in case of a cache miss, and queries the backing replica. */
  getAllDocsAtPath<F = DefaultFormats>(
    path: Path,
    formats?: FormatsArg<F>,
  ): FormatDocType<F>[] {
    return this.queryDocs({
      historyMode: "all",
      orderBy: "path DESC",
      filter: { path: path },
    }, formats);
  }

  /** Fetch latest version of a doc at a path from the cache. Returns an empty array in case of a cache miss, and queries the backing replica. */
  getLatestDocAtPath<F = DefaultFormat>(
    path: Path,
    format?: FormatArg<F>,
  ): FormatDocType<F> | undefined {
    const docs = this.queryDocs({
      historyMode: "latest",
      orderBy: "path DESC",
      filter: { path: path },
    }, format ? [format] : undefined);
    if (docs.length === 0) {
      return undefined;
    }
    return docs[0] as FormatDocType<F>;
  }

  /** Fetch docs matching a query from the cache. Returns an empty array in case of a cache miss, and queries the backing replica. */
  queryDocs<F = DefaultFormats>(
    query: Omit<Query<[string]>, "formats"> = {},
    formats?: FormatsArg<F>,
  ): FormatDocType<F>[] {
    if (this.closed) throw new ReplicaCacheIsClosedError();
    if (this.replica.isClosed()) {
      throw new ReplicaIsClosedError();
    }

    const f = formats ? formats : DEFAULT_FORMATS;
    const queryWithFormats = {
      ...query,
      formats: f.map((f) => f.id),
    };

    // make a deterministic string out of the query
    const cleanUpQueryResult = cleanUpQuery(queryWithFormats);

    if (cleanUpQueryResult.willMatch === "nothing") {
      return [];
    }

    const queryString = stringify(cleanUpQueryResult.query);

    // Check if the cache has anything from this
    // and if so, return it.
    const cachedResult = this.docCache.get(queryString);

    if (cachedResult) {
      // If the result has expired, query the storage again.
      if (Date.now() > cachedResult.expires) {
        this.replica.queryDocs(query, formats).then((docs) => {
          const localIndexes = docs.map(justLocalIndex).sort();
          const cacheLocalIndexes = cachedResult.docs.map(justLocalIndex)
            .sort();

          // Return early if the new result is the same as the cached result.
          // (The sets of localIndexes should be identical if they're the same)
          if (shallowEqualArrays(localIndexes, cacheLocalIndexes)) {
            return;
          }

          this.docCache.set(queryString, {
            stream: cachedResult.stream,
            close: cachedResult.close,
            docs: docs,
            expires: Date.now() + this.timeToLive,
          });

          logger.debug("Updated cache because result expired.");
          this.fireOnCacheUpdateds();
        });
      }

      return cachedResult.docs as FormatDocType<F>[];
    }

    // If there's no result, let's follow this query.
    const stream = this.replica.getQueryStream(query, "new", formats);

    const callbackSink = new CallbackSink<
      QuerySourceEvent<DocBase<string>>
    >();

    const unsub = callbackSink.onWrite((event) => {
      if (event.kind === "existing" || event.kind === "success") {
        logger.debug({ doc: event.doc.path, queryString });
        this._updateCache(queryString, event.doc);
      }
    });

    const callbackStream = new WritableStream(callbackSink);

    const abortController = new AbortController();

    stream.pipeTo(callbackStream, { signal: abortController.signal });

    const close = () => {
      unsub();
      //abortController.abort();
    };

    // Set an empty entry in the cache so that calls which happen
    // while we wait for the first request to resolve don't queue up
    // more 'initial' queries.
    this.docCache.set(queryString, {
      stream,
      docs: [],
      expires: Date.now() + this.timeToLive,
      close,
    });

    // Query the storage, set the eventual result in the cache.
    this.replica.queryDocs(queryWithFormats).then((docs) => {
      this.docCache.set(queryString, {
        stream,
        close,
        docs: docs,
        expires: Date.now() + this.timeToLive,
      });
      logger.debug("Updated cache with a new entry.");
      this.fireOnCacheUpdateds();
    });

    // Return an empty result for the moment.
    return [];
  }

  /** Returns an array of all unique paths of documents returned by a given query. */
  queryPaths<F = DefaultFormats>(
    query: Omit<Query<[string]>, "formats"> = {},
    formats?: FormatsArg<F>,
  ): Path[] {
    const docs = this.queryDocs(query, formats);
    const pathsSet = new Set(docs.map(({ path }) => path));
    return Array.from(pathsSet).sort();
  }

  /** Returns an array of all unique authors of documents returned by a given query. */
  queryAuthors<F = DefaultFormats>(
    query: Omit<Query<[string]>, "formats"> = {},
    formats?: FormatsArg<F>,
  ): AuthorAddress[] {
    const docs = this.queryDocs(query, formats);
    const authorsSet = new Set(docs.map(({ author }) => author));
    return Array.from(authorsSet).sort();
  }

  // CACHE

  // Update cache entries as best as we can until results from the backing storage arrive.
  _updateCache(key: string, doc: DocBase<string>): void {
    const entry = this.docCache.get(key);

    // This shouldn't happen really.
    if (!entry) {
      return;
    }

    const query: Query<string[]> = JSON.parse(key);

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
      this.docCache.set(key, {
        ...entry,
        docs: sortAndLimit(query, nextDocs),
      });
      this.fireOnCacheUpdateds();
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

      this.docCache.set(key, {
        ...entry,
        docs: sortAndLimit(query, nextDocs),
      });
      this.fireOnCacheUpdateds();
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
      !shallowEqualObjects(doc, latestDoc);

    const docIsLater = doc.timestamp > latestDoc.timestamp;

    // The doc has changed or has a newer timestamp,
    // So replace it.
    if (docIsDifferent && docIsLater) {
      logger.debug(
        "Updated cache after replacing a doc with its latest version.",
      );
      replaceDoc({ exact: false });
      return;
    }
  }

  // SUBSCRIBE

  private fireOnCacheUpdateds() {
    this.version++;

    this.onFireCacheUpdatedsWrapper(() => {
      this.onCacheUpdatedCallbacks.forEach((cb) => {
        cb();
      });
    });
  }

  /** Subscribes to the cache, calling a callback when previously returned results can be considered stale. Returns a function for unsubscribing. */
  onCacheUpdated(callback: () => void): () => void {
    if (this.closed) throw new ReplicaCacheIsClosedError();
    if (this.replica.isClosed()) {
      throw new ReplicaIsClosedError();
    }

    this.onCacheUpdatedCallbacks.add(callback);

    return () => {
      this.onCacheUpdatedCallbacks.delete(callback);
    };
  }

  // PASSTHROUGH TO REPLICA
  // These should just be methods which modify the replica

  // SET - just pass along to the backing storage

  /** Add a new document directly to the backing replica. */
  set<F = DefaultFormat>(
    credentials: FormatCredentialsType<F>,
    docToSet: Omit<FormatInputType<F>, "format">,
    format?: FormatArg<F>,
  ): Promise<
    IngestEvent<FormatDocType<F>> | ValidationError
  > {
    if (this.closed) throw new ReplicaCacheIsClosedError();

    return this.replica.set(credentials, docToSet, format);
  }

  // OVERWRITE

  // We just call the backing storage's implementation
  // A user calling this method probably wants to be sure
  // that their docs are _really_ deleted,
  // so we don't do a quick and dirty version in the cache here.

  /** Call this method on the backing replica. */
  overwriteAllDocsByAuthor<F = DefaultFormat>(
    credentials: FormatCredentialsType<F>,
    format?: FormatArg<F>,
  ) {
    if (this.closed) throw new ReplicaCacheIsClosedError();
    if (this.replica.isClosed()) {
      throw new ReplicaIsClosedError();
    }
    return this.replica.overwriteAllDocsByAuthor(
      credentials,
      format,
    );
  }

  wipeDocAtPath<F = DefaultFormat>(
    credentials: FormatCredentialsType<F>,
    path: string,
    format: FormatArg<F> = DEFAULT_FORMAT as unknown as FormatArg<F>,
  ): Promise<IngestEvent<FormatDocType<F>> | ValidationError> {
    if (this.closed) throw new ReplicaCacheIsClosedError();

    return this.replica.wipeDocAtPath(credentials, path, format);
  }

  // ATTACHMENTS

  private attachmentCache = new Map<
    string,
    AttachmentCacheEntry<any>
  >();

  private onReplicaEvent(
    event:
      | ExpireEvent<DocBase<string>>
      | IngestEventSuccess<DocBase<string>>
      | AttachmentIngestEvent<DocBase<string>>,
  ) {
    const cacheKey = `${event.doc.path}|${event.doc.author}`;
    const cacheEntry = this.attachmentCache.get(cacheKey);

    // We're not interested in this hash. Return early.
    if (!cacheEntry) {
      return;
    }

    // Update cache
    this.replica.getAttachment(event.doc, cacheEntry.format).then((res) => {
      // Update cache

      this.attachmentCache.set(
        cacheKey,
        {
          expires: Date.now() + this.timeToLive,
          attachment: res,
          format: cacheEntry.format,
        },
      );

      this.fireOnCacheUpdateds();
    });
  }

  getAttachment<F = DefaultFormat>(
    doc: FormatDocType<F>,
    format: FormatArg<F> = DEFAULT_FORMAT as unknown as FormatArg<F>,
  ): DocAttachment | undefined | ValidationError {
    if (this.closed) throw new ReplicaCacheIsClosedError();
    if (this.replica.isClosed()) {
      throw new ReplicaIsClosedError();
    }

    // Check if this doc can have an attachment.
    const attachmentInfo = format.getAttachmentInfo(doc);

    if (isErr(attachmentInfo)) {
      return attachmentInfo;
    }

    const cacheKey = `${doc.path}|${doc.author}`;

    // Check if it's in the cache.
    const cachedResult = this.attachmentCache.get(cacheKey);

    if (cachedResult) {
      if (Date.now() > cachedResult.expires) {
        this.replica.getAttachment(doc, format).then((res) => {
          // Update cache
          this.attachmentCache.set(
            cacheKey,
            {
              expires: Date.now() + this.timeToLive,
              attachment: res,
              format,
            },
          );

          this.fireOnCacheUpdateds();
        });
      }

      return cachedResult.attachment;
    }

    // Set an empty entry in the cache so that calls which happen
    // while we wait for the first request to resolve don't queue up
    // more 'initial' queries.
    this.attachmentCache.set(cacheKey, {
      attachment: undefined,
      expires: Date.now() + this.timeToLive,
      format,
    });

    // Query the storage, set the eventual result in the cache.
    this.replica.getAttachment(doc, format).then((res) => {
      // Update cache

      this.attachmentCache.set(
        cacheKey,
        {
          expires: Date.now() + this.timeToLive,
          attachment: res,
          format,
        },
      );

      this.fireOnCacheUpdateds();
    });

    // Return the nothing for now.
    return undefined;
  }

  addAttachments<F = DefaultFormats>(
    docs: FormatDocType<F>[],
    formats?: FormatsArg<F>,
  ): DocWithAttachment<FormatDocType<F>>[] {
    const result: DocWithAttachment<FormatDocType<F>>[] = [];

    const lookup = getFormatLookup(formats);

    for (const doc of docs) {
      const cachedResult = this.getAttachment(doc, lookup[doc.format]);

      result.push({
        ...doc,
        attachment: cachedResult,
      });
    }

    return result;
  }
}
