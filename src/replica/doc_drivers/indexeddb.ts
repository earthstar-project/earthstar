import { ShareAddress } from "../../util/doc-types.ts";

//--------------------------------------------------

import { Logger } from "../../util/log.ts";
import { deferred } from "https://deno.land/std@0.150.0/async/deferred.ts";
import {
  EarthstarError,
  isErr,
  ReplicaIsClosedError,
  ValidationError,
} from "../../util/errors.ts";
import { IReplicaDocDriver } from "../replica-types.ts";
import { Query } from "../../query/query-types.ts";
import { DocBase } from "../../util/doc-types.ts";
import { cleanUpQuery, docMatchesFilter } from "../../query/query.ts";
import { Cmp } from "../util-types.ts";
import { compareArrays, compareByObjKey } from "../compare.ts";
import { checkShareIsValid } from "../../core-validators/addresses.ts";
import { sleep } from "../../util/misc.ts";
const logger = new Logger("replica driver indexeddb", "gold");

function docComparePathASCthenNewestFirst<DocType extends DocBase<string>>(
  a: DocType,
  b: DocType,
): Cmp {
  // Sorts docs by path ASC.
  // Within each paths, sorts by timestamp DESC (newest fist) and breaks ties using the signature ASC.
  return compareArrays(
    [a.path, a.timestamp, a.signature],
    [b.path, b.timestamp, a.signature],
    ["ASC", "DESC", "ASC"],
  );
}

function docComparePathDESCthenNewestFirst<DocType extends DocBase<string>>(
  a: DocType,
  b: DocType,
): Cmp {
  // Sorts docs by path DESC.
  // Within each paths, sorts by timestamp DESC (newest fist) and breaks ties using the signature ASC.
  return compareArrays(
    [a.path, a.timestamp, a.signature],
    [b.path, b.timestamp, a.signature],
    ["DESC", "DESC", "ASC"],
  );
}

//================================================================================

/** A replica driver which persists to IndexedDB in the browser. Maximum storage capacity varies, but is generally upwards of one gigabyte.
 * Works in browsers.
 */
const DOCS_STORE = "docs";
const CONFIG_STORE = "config";

export class DocDriverIndexedDB implements IReplicaDocDriver {
  share: ShareAddress;

  private db = deferred<IDBDatabase>();
  private gotInitialMaxLocalIndex = deferred<number>();
  private localMaxLocalIndex = -1;
  private closed = false;

  /**
   * @param share - The address of the share the replica belongs to.
   */
  constructor(share: ShareAddress, namespace?: string) {
    const addressIsValidResult = checkShareIsValid(share);

    if (isErr(addressIsValidResult)) {
      throw addressIsValidResult;
    }

    this.share = share;

    logger.debug("constructor");

    // dnt-shim-ignore
    if (!(window as any).indexedDB) {
      throw new EarthstarError("IndexedDB is not supported by this runtime.");
    }

    const request = ((window as any).indexedDB as IDBFactory).open(
      `earthstar:share_docs:${this.share}${namespace ? `/${namespace}` : ""}`,
      1,
    );

    request.onerror = () => {
      logger.error(`Could not open IndexedDB for ${this.share}'s attachments.`);
      logger.error(request.error);
      throw new EarthstarError(
        `Could not open IndexedDB for ${this.share}'s attachments.`,
      );
    };

    request.onupgradeneeded = function () {
      const db = request.result;

      // Storing docs
      const docsStore = db.createObjectStore(DOCS_STORE, {
        keyPath: ["path", "author"],
      });

      docsStore.createIndex("comboIndex", [
        "_localIndex",
        "timestamp",
        "path",
        "author",
      ], {
        unique: true,
      });

      docsStore.createIndex("pathTimestampIndex", [
        "path",
        "timestamp",
      ], {
        unique: false,
      });

      docsStore.createIndex("pathAuthorIndex", [
        "path",
        "author",
      ], {
        unique: true,
      });

      docsStore.createIndex("deleteAfterIndex", "deleteAfter", {
        unique: false,
      });

      docsStore.createIndex("localIndexIndex", "_localIndex", {
        unique: true,
      });

      // Storing config
      const configStore = db.createObjectStore(CONFIG_STORE, {
        keyPath: "key",
      });

      configStore.createIndex("keyIndex", [
        "key",
      ], { unique: true });
    };

    request.onsuccess = () => {
      this.db.resolve(request.result);

      const localIndex = request.result.transaction([DOCS_STORE], "readonly")
        .objectStore(
          DOCS_STORE,
        ).index("localIndexIndex");

      const getLast = localIndex.openCursor(null, "prev");

      getLast.onsuccess = () => {
        if (getLast.result) {
          this.gotInitialMaxLocalIndex.resolve(
            getLast.result.value._localIndex,
          );
        } else {
          this.gotInitialMaxLocalIndex.resolve(-1);
        }
      };
    };

    this.gotInitialMaxLocalIndex.then((localIndex) => {
      this.localMaxLocalIndex = localIndex;
    });
  }

  isClosed(): boolean {
    return this.closed;
  }

  async close(erase: boolean): Promise<void> {
    if (this.closed) throw new ReplicaIsClosedError();

    this.closed = true;

    const eraseDeferred = deferred<void>();

    if (erase) {
      const db = await this.db;

      const transaction = db.transaction(
        [DOCS_STORE, CONFIG_STORE],
        "readwrite",
      );

      const eraseDocsDeferred = deferred<void>();
      const eraseConfigDeferred = deferred<void>();

      const deleteDocs = transaction.objectStore(DOCS_STORE).clear().onsuccess =
        () => {
          eraseDocsDeferred.resolve();
        };

      const deleteConfig = transaction.objectStore(CONFIG_STORE).clear()
        .onsuccess = () => {
          eraseConfigDeferred.resolve();
        };

      await Promise.all([deleteDocs, deleteConfig]);

      eraseDeferred.resolve();
    } else {
      eraseDeferred.resolve();
    }

    (await (this.db)).close();

    await sleep(20);

    return eraseDeferred;
  }

  // TODO: This has to return a promise instead. sorry cinn.
  async getMaxLocalIndex(): Promise<number> {
    await this.gotInitialMaxLocalIndex;

    return this.localMaxLocalIndex;
  }

  //--------------------------------------------------
  // GET

  async queryDocs(queryToClean: Query<string[]>): Promise<DocBase<string>[]> {
    const db = await this.db;
    const docStore = db.transaction([DOCS_STORE], "readonly").objectStore(
      DOCS_STORE,
    );
    const docsPromise = deferred<DocBase<string>[]>();

    // clean up the query and exit early if possible.
    const { query, willMatch } = cleanUpQuery(queryToClean);
    logger.debug(`    cleanUpQuery.  willMatch = ${willMatch}`);
    if (willMatch === "nothing") {
      return [];
    }

    // Optimise for a case when we know the path up front, and we want the latest version.
    if (query.filter?.path && query.historyMode === "latest") {
      // This range will get every document with this path with any timestamp.
      const range = IDBKeyRange.bound(
        [query.filter.path, query.filter.timestampGt || 0],
        [
          query.filter.path,
          query.filter.timestampLt || Number.MAX_SAFE_INTEGER,
        ],
      );

      const index = docStore.index("pathTimestampIndex");

      // Get the last result (which will be the one with the highest timestamp)
      const getCursor = index.openCursor(range);

      getCursor.onsuccess = () => {
        if (getCursor.result?.value) {
          docsPromise.resolve([getCursor.result.value]);
          // We only need the last result.
        } else {
          docsPromise.resolve([]);
        }
      };
    } else if (query.filter?.path && query.historyMode === "all") {
      const index = docStore.index("pathAuthorIndex");

      const range = IDBKeyRange.bound([query.filter.path, " "], [
        query.filter.path,
        "~",
      ]);

      const getOp = index.getAll(range);

      getOp.onsuccess = () => {
        if (getOp.result) {
          docsPromise.resolve(Array.from(getOp.result));
        } else {
          docsPromise.resolve([]);
        }
      };
    } else {
      const pathLower = query.startAfter?.path || query.filter?.path ||
        query.filter?.pathStartsWith || " ";
      const authorLower = query.filter?.author || " ";
      const timestampLower = query.filter?.timestamp ||
        query.filter?.timestampGt || 0;
      const localIndexLower = query.startAfter?.localIndex || 0;

      const pathUpper = query.filter?.path || "~";
      const authorUpper = query.filter?.author || "~";
      const timestampUpper = query.filter?.timestamp ||
        query.filter?.timestampLt || Number.MAX_SAFE_INTEGER;
      const localIndexUpper = Number.MAX_SAFE_INTEGER;

      const range = IDBKeyRange.bound(
        [localIndexLower, timestampLower, pathLower, authorLower],
        [
          localIndexUpper,
          timestampUpper,
          pathUpper,
          authorUpper,
        ],
      );

      const index = docStore.index("comboIndex");

      const getOp = index.getAll(range);

      getOp.onsuccess = () => {
        if (getOp.result) {
          docsPromise.resolve(getOp.result);
        } else {
          // done?
          docsPromise.resolve([]);
        }
      };
    }

    const docs = await docsPromise;

    if (query.historyMode === "latest") {
      const docsForLatest = docs.splice(0, docs.length);

      const latests = new Map<string, DocBase<string>>();

      for (const doc of docsForLatest) {
        const latest = latests.get(doc.path);

        if (!latest || latest.timestamp < doc.timestamp) {
          latests.set(doc.path, doc);
        }
      }

      docs.push(...latests.values());
    }

    const filteredDocs: DocBase<string>[] = [];
    logger.debug(`    filtering docs`);

    // Filter.
    for (const doc of docs) {
      // I think we might not need this here.
      // skip ahead until we reach startAfter
      /*
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
            (doc._localIndex ?? 0) <= query.startAfter.localIndex
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
            (doc._localIndex ?? 0) >= query.startAfter.localIndex
          ) {
            continue;
          }
          // doc.path is now < startAfter.localIndex (we're descending)
        }
      }
      */

      // apply filter: skip docs that don't match
      if (query.filter && !docMatchesFilter(doc, query.filter)) continue;

      // finally, here's a doc we want
      filteredDocs.push(doc);
    }

    // orderBy
    logger.debug(`    ordering docs: ${query.orderBy}`);
    if (query.orderBy === "path ASC") {
      filteredDocs.sort(docComparePathASCthenNewestFirst);
    } else if (query.orderBy === "path DESC") {
      filteredDocs.sort(docComparePathDESCthenNewestFirst);
    } else if (query.orderBy === "localIndex ASC") {
      filteredDocs.sort(compareByObjKey("_localIndex", "ASC"));
    } else if (query.orderBy === "localIndex DESC") {
      filteredDocs.sort(compareByObjKey("_localIndex", "DESC"));
    } else if (query.orderBy) {
      throw new ValidationError(
        "unrecognized query orderBy: " + JSON.stringify(query.orderBy),
      );
    }

    // limit
    if (
      query.limit !== undefined && docs.length >= query.limit
    ) {
      return filteredDocs.slice(0, query.limit);
    }

    logger.debug(
      `    queryDocs is done: found ${filteredDocs.length} docs.`,
    );
    return filteredDocs;
  }

  // Set

  async upsert<DocType extends DocBase<string>>(
    doc: DocType,
  ): Promise<DocType> {
    const db = await this.db;
    const docStore = db.transaction([DOCS_STORE], "readwrite").objectStore(
      DOCS_STORE,
    );

    const index = docStore.index("pathAuthorIndex");

    const updatedExisting = deferred<boolean>();
    const cursorExisting = index.openCursor([doc.path, doc.author]);

    await this.gotInitialMaxLocalIndex;
    this.localMaxLocalIndex += 1;
    doc._localIndex = this.localMaxLocalIndex;

    cursorExisting.onsuccess = () => {
      if (cursorExisting.result) {
        const updateOp = cursorExisting.result.update(doc);

        updateOp.onsuccess = () => {
          updatedExisting.resolve(!!updateOp.result);
        };
      } else {
        updatedExisting.resolve(false);
      }
    };

    const didUpdate = await updatedExisting;

    if (didUpdate) {
      return doc;
    }

    const sndDocStore = db.transaction([DOCS_STORE], "readwrite").objectStore(
      DOCS_STORE,
    );

    const putOp = sndDocStore.put(doc);

    const didPut = deferred();

    putOp.onsuccess = () => {
      didPut.resolve();
    };

    putOp.onerror = () => {
      throw (putOp.error);
    };

    await didPut;

    return doc;
  }

  async eraseExpiredDocs(): Promise<DocBase<string>[]> {
    const deletedDocs: DocBase<string>[] = [];

    const db = await this.db;
    const docStore = db.transaction([DOCS_STORE], "readwrite").objectStore(
      DOCS_STORE,
    );

    const index = docStore.index("deleteAfterIndex");

    const microNow = Date.now() * 1000;
    const range = IDBKeyRange.bound(0, microNow);
    const cursor = index.openCursor(range);
    const deletedAll = deferred();

    cursor.onsuccess = () => {
      if (cursor.result?.value) {
        const doc: DocBase<string> = cursor.result.value;

        if (doc.deleteAfter !== null && doc.deleteAfter !== undefined) {
          deletedDocs.push(doc);

          const deleteOp = cursor.result.delete();

          deleteOp.onsuccess = () => {
            cursor.result?.continue();
          };
        }
      } else {
        // Done

        deletedAll.resolve();
      }
    };

    await deletedAll;

    return deletedDocs;
  }

  // Config stuff.

  async getConfig(key: string): Promise<string | undefined> {
    const db = await this.db;
    const configStore = db.transaction([CONFIG_STORE], "readonly").objectStore(
      CONFIG_STORE,
    );

    const gotConfig = deferred<string | undefined>();
    const getOp = configStore.get(key);

    getOp.onsuccess = () => {
      gotConfig.resolve(getOp.result?.value);
    };

    return gotConfig;
  }

  async setConfig(key: string, value: string): Promise<void> {
    const db = await this.db;
    const configStore = db.transaction([CONFIG_STORE], "readwrite").objectStore(
      CONFIG_STORE,
    );

    const didSetConfig = deferred<void>();
    const setOp = configStore.put({ key, value });

    setOp.onsuccess = () => {
      didSetConfig.resolve();
    };

    return didSetConfig;
  }

  async listConfigKeys(): Promise<string[]> {
    const db = await this.db;
    const configStore = db.transaction([CONFIG_STORE], "readonly").objectStore(
      CONFIG_STORE,
    );

    const gotConfigKeys = deferred<string[]>();

    const index = configStore.index("keyIndex");

    const getAllOp = index.openKeyCursor();

    const keys: string[] = [];

    getAllOp.onsuccess = () => {
      if (getAllOp.result) {
        keys.push(getAllOp.result.primaryKey as string);
        getAllOp.result.continue();
      } else {
        gotConfigKeys.resolve(keys);
      }
    };

    return gotConfigKeys;
  }

  async deleteConfig(key: string): Promise<boolean> {
    const db = await this.db;
    const configStore = db.transaction([CONFIG_STORE], "readwrite").objectStore(
      CONFIG_STORE,
    );

    const didDeleteConfig = deferred<boolean>();

    const index = configStore.index("keyIndex");

    const range = IDBKeyRange.bound([key], [key]);

    const cursor = index.openCursor(range);

    cursor.onsuccess = () => {
      if (cursor.result) {
        const deleteOp = cursor.result.delete();

        deleteOp.onsuccess = () => {
          didDeleteConfig.resolve(true);
        };
      } else {
        didDeleteConfig.resolve(false);
      }
    };

    return didDeleteConfig;
  }
}
