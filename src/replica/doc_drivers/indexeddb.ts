// @deno-types="./indexeddb_types.deno.d.ts"

import { ShareAddress } from "../../util/doc-types.ts";
import { ReplicaIsClosedError } from "../../util/errors.ts";
import { DocDriverMemory } from "./memory.ts";
import { Query } from "../../query/query-types.ts";

//--------------------------------------------------

import { Logger } from "../../util/log.ts";
import { ExtractDocType } from "../../formatters/formatter_types.ts";
import { FormatterEs4 } from "../../formatters/formatter_es4.ts";
const logger = new Logger("replica driver indexeddb", "gold");

//================================================================================

const DOC_STORE = "documents";
const DOCUMENTS_ID = "allDocs";
const CONFIG_STORE = "config";

/** A replica driver which persists to IndexedDB in the browser. Maximum storage capacity varies, but is generally upwards of one gigabyte.
 * Works in browsers.
 */
export class DocDriverIndexedDB extends DocDriverMemory {
  _db: IDBDatabase | null = null;

  /**
   * @param share - The address of the share the replica belongs to.
   */
  constructor(share: ShareAddress) {
    super(share);
    logger.debug("constructor");

    this.docByPathAndAuthor = new Map();
    this.docsByPathNewestFirst = new Map();
  }

  getIndexedDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (this._db) {
        return resolve(this._db);
      }

      // dnt-shim-ignore
      if (!(window as any).indexedDB) {
        return reject();
      }

      // dnt-shim-ignore
      const request = ((window as any).indexedDB as IDBFactory).open(
        `earthstar:share:${this.share}`,
        1,
      );

      request.onerror = () => {
        logger.error(`Could not open IndexedDB for ${this.share}`);
        logger.error(request.error);
        return reject(request.error);
      };

      request.onupgradeneeded = function () {
        const db = request.result;

        // we're going to store everything in one row.
        db.createObjectStore(DOC_STORE, { keyPath: "id" });
        db.createObjectStore(CONFIG_STORE, { keyPath: "key" });
      };

      request.onsuccess = () => {
        this._db = request.result;

        const transaction = request.result.transaction(
          [DOC_STORE],
          "readonly",
        );

        const store = transaction.objectStore(DOC_STORE);
        const retrieval = store.get(DOCUMENTS_ID);

        retrieval.onsuccess = () => {
          if (!retrieval.result || !retrieval.result["docs"]) {
            return resolve(request.result);
          }

          const docs = retrieval.result["docs"];

          this.docByPathAndAuthor = new Map(
            Object.entries(docs.byPathAndAuthor),
          );
          this.docsByPathNewestFirst = new Map(
            Object.entries(docs.byPathNewestFirst),
          );

          const localIndexes = Array.from(this.docByPathAndAuthor.values()).map(
            (doc) => doc._localIndex as number,
          );
          this._maxLocalIndex = Math.max(...localIndexes);

          return resolve(request.result);
        };

        retrieval.onerror = () => {
          logger.debug(
            `StorageIndexedDB constructing: No existing DB for ${this.share}`,
          );
          reject();
        };
      };
    });
  }

  //--------------------------------------------------
  // LIFECYCLE

  // isClosed(): inherited
  async close(erase: boolean): Promise<void> {
    logger.debug("close");
    if (this._isClosed) {
      throw new ReplicaIsClosedError();
    }
    if (erase) {
      logger.debug("...close: and erase");
      this._configKv = {};
      this._maxLocalIndex = -1;
      this.docsByPathNewestFirst.clear();
      this.docByPathAndAuthor.clear();

      logger.debug("...close: erasing indexeddb");

      const db = await this.getIndexedDb();

      for (let key of await this.listConfigKeys()) {
        await this.deleteConfig(key);
      }

      const deletion = db
        .transaction(DOC_STORE, "readwrite")
        .objectStore(DOC_STORE)
        .delete(DOCUMENTS_ID);

      deletion.onsuccess = () => {
        logger.debug("...close: erasing is done");
      };
    }
    this._isClosed = true;
    logger.debug("...close is done.");
  }

  //--------------------------------------------------
  // CONFIG

  async getConfig(key: string): Promise<string | undefined> {
    if (this._isClosed) {
      throw new ReplicaIsClosedError();
    }

    const db = await this.getIndexedDb();

    return new Promise((resolve, reject) => {
      const retrieval = db
        .transaction(CONFIG_STORE, "readonly")
        .objectStore(CONFIG_STORE)
        .get(key);

      retrieval.onsuccess = () => {
        if (!retrieval.result) {
          return resolve(undefined);
        }

        return resolve(retrieval.result.value);
      };

      retrieval.onerror = () => {
        reject(retrieval.error);
      };
    });
  }
  async setConfig(key: string, value: string): Promise<void> {
    if (this._isClosed) {
      throw new ReplicaIsClosedError();
    }

    const db = await this.getIndexedDb();

    return new Promise((resolve, reject) => {
      const set = db
        .transaction(CONFIG_STORE, "readwrite")
        .objectStore(CONFIG_STORE)
        .put({ key, value });

      set.onsuccess = () => {
        resolve();
      };

      set.onerror = () => {
        reject();
      };
    });
  }
  async listConfigKeys(): Promise<string[]> {
    if (this._isClosed) {
      throw new ReplicaIsClosedError();
    }

    const db = await this.getIndexedDb();

    return new Promise((resolve, reject) => {
      const getKeys = db
        .transaction(CONFIG_STORE, "readonly")
        .objectStore(CONFIG_STORE)
        .getAllKeys();

      getKeys.onsuccess = () => {
        resolve(getKeys.result.sort() as string[]);
      };

      getKeys.onerror = () => {
        reject();
      };
    });
  }

  async deleteConfig(key: string): Promise<boolean> {
    if (this._isClosed) {
      throw new ReplicaIsClosedError();
    }

    const db = await this.getIndexedDb();

    const hadIt = (await this.getConfig(key)) !== undefined;

    return new Promise((resolve, reject) => {
      const deletion = db
        .transaction(CONFIG_STORE, "readwrite")
        .objectStore(CONFIG_STORE)
        .delete(key);

      deletion.onsuccess = () => {
        resolve(hadIt);
      };

      deletion.onerror = () => {
        reject();
      };
    });
  }

  //--------------------------------------------------
  // GET

  // getMaxLocalIndex(): inherited

  async queryDocs(query: Query) {
    // Make sure the IndexedDB has been loaded up
    await this.getIndexedDb();
    const result = await super.queryDocs(query);

    return result;
  }

  //--------------------------------------------------
  // SET

  async upsert<DocType extends ExtractDocType<typeof FormatterEs4>>(
    doc: DocType,
  ): Promise<DocType> {
    if (this._isClosed) {
      throw new ReplicaIsClosedError();
    }
    const upsertedDoc = await super.upsert(doc);

    // After every upsert, for now, we save everything
    // to IndexedDB as a single giant blob.
    // TODO: debounce this, only do it every 1 second or something

    const docs = {
      byPathAndAuthor: Object.fromEntries(this.docByPathAndAuthor),
      byPathNewestFirst: Object.fromEntries(this.docsByPathNewestFirst),
    };

    const db = await this.getIndexedDb();

    return new Promise((resolve, reject) => {
      const put = db
        .transaction(DOC_STORE, "readwrite")
        .objectStore(DOC_STORE)
        .put({
          id: DOCUMENTS_ID,
          docs,
        });

      put.onsuccess = () => {
        resolve(upsertedDoc);
      };

      put.onerror = () => {
        reject();
      };
    });
  }
}
