// @deno-types="./indexeddb_types.deno.d.ts"

import { ShareAddress } from "../../util/doc-types.ts";

//--------------------------------------------------

import { Logger } from "../../util/log.ts";
import { deferred } from "https://deno.land/std@0.150.0/async/deferred.ts";
import { EarthstarError, ReplicaIsClosedError } from "../../util/errors.ts";
import { IReplicaDocDriver } from "../replica-types.ts";
import { Query } from "../../query/query-types.ts";
import { DocBase } from "../../util/doc-types.ts";
const logger = new Logger("replica driver indexeddb", "gold");

//================================================================================

/** A replica driver which persists to IndexedDB in the browser. Maximum storage capacity varies, but is generally upwards of one gigabyte.
 * Works in browsers.
 */
const DOCS_STORE = "docs";

export class DocDriverIndexedDB implements IReplicaDocDriver {
  private db = deferred<IDBDatabase>();
  private maxLocalIndex = -1;
  private share: ShareAddress;
  private closed = false;

  /**
   * @param share - The address of the share the replica belongs to.
   */
  constructor(share: ShareAddress) {
    logger.debug("constructor");

    // dnt-shim-ignore
    if (!(window as any).indexedDB) {
      throw new EarthstarError("IndexedDB is not supported by this runtime.");
    }

    const request = ((window as any).indexedDB as IDBFactory).open(
      `earthstar:share_docs:${this.share}`,
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

      const objectStore = db.createObjectStore(DOCS_STORE, {
        keyPath: "_localIndex",
      });
      objectStore.createIndex("pathAuthorTimestamp", [
        "path",
        "author",
        "timestamp",
      ], {
        unique: true,
      });

      objectStore.createIndex("localIndex", [
        "_localIndex",
      ], {
        unique: true,
      });
    };

    request.onsuccess = () => {
      this.db.resolve(request.result);

      const localIndex = request.result.transaction([DOCS_STORE]).objectStore(
        DOCS_STORE,
      ).index("localIndex");

      const getLast = localIndex.openCursor(null, "prev");

      getLast.onsuccess = () => {
        if (getLast.result) {
          this.maxLocalIndex = getLast.result.value._localIndex;
        }
      };
    };
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

      db.transaction([DOCS_STORE]).objectStore(DOCS_STORE).clear().onsuccess =
        () => {
          eraseDeferred.resolve();
        };
    } else {
      eraseDeferred.resolve();
    }

    return eraseDeferred;
  }

  // TODO: This has to return a promise instead. sorry cinn.
  getMaxLocalIndex(): number {
    return this.maxLocalIndex;
  }

  //--------------------------------------------------
  // GET

  async queryDocs(query: Query<string[]>): Promise<DocBase<string>[]> {
    const db = await this.db;
    const docStore = db.transaction([DOCS_STORE], "readonly").objectStore(
      DOCS_STORE,
    );
    const docs = [];

    // Handle the simplest case where the path is defined by the filter.
    if (query.filter) {
      // This is the way to do a partial key search in IndexedDB. Unfortunately.

      const pathLower = query.filter.path || query.filter.pathStartsWith || " ";
      const authorLower = query.filter.author || " ";
      const timestampLower = query.filter.timestamp ||
        query.filter.timestampGt || 0;

      const pathUpper = query.filter.path || "~";
      const authorUpper = query.filter.author || "~";
      const timestampUpper = query.filter.timestamp ||
        query.filter.timestampLt || Number.MAX_SAFE_INTEGER;

      const range = IDBKeyRange.bound(
        [pathLower, authorLower, timestampLower],
        [
          pathUpper,
          authorUpper,
          timestampUpper,
        ],
      );

      const index = docStore.index("pathAndTimestamp");

      if (query.historyMode === "all") {
        const getCursor = index.openCursor(range, "prev");

        getCursor.onsuccess = () => {
          if (getCursor.result?.value) {
            docs.push(getCursor.result.value);
            getCursor.result.continue();
          }
        };
      } else {
        const getCursor = index.openCursor(range, "prev");

        getCursor.onsuccess = () => {
          if (getCursor.result?.value) {
            docs.push(getCursor.result.value);
          }
        };
      }
    }

    // Filter.
    // Sort.
    // Limit.
  }
}
