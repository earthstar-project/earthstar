// @deno-types="./indexeddb-types.deno.d.ts"

import { Doc, WorkspaceAddress } from "../util/doc-types.ts";
import { StorageIsClosedError } from "../util/errors.ts";
import { StorageDriverAsyncMemory } from "./storage-driver-async-memory.ts";

//--------------------------------------------------

import { Logger } from "../util/log.ts";
let logger = new Logger("storage driver indexeddb", "yellowBright");

//================================================================================

const DOC_STORE = "documents";
const DOCUMENTS_ID = "allDocs";
const CONFIG_STORE = "config";

/** A storage driver which persists to IndexedDB in the browser. Maximum storage capacity varies, but is generally upwards of one gigabyte.
 * Works in browsers.
 */
export class StorageDriverIndexedDB extends StorageDriverAsyncMemory {
    _db: IDBDatabase | null = null;

    /**
     * @param workspace - The address of the share the replica belongs to.
     */
    constructor(workspace: WorkspaceAddress) {
        super(workspace);
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

            // Deno doesn't have indexedDB yet, so we need to cast as any.
            // dnt-shim-ignore
            const request = (window as any).indexedDB.open(
                `stonesoup:database:${this.workspace}`,
                1,
            );

            request.onerror = () => {
                logger.error(`Could not open IndexedDB for ${this.workspace}`);
                logger.error(request.error);
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
                    const docs = retrieval.result;

                    if (!docs) {
                        return resolve(request.result);
                    }

                    this.docByPathAndAuthor = new Map(
                        Object.entries(docs.byPathAndAuthor),
                    );
                    this.docsByPathNewestFirst = new Map(
                        Object.entries(docs.byPathNewestFirst),
                    );

                    return resolve(request.result);
                };

                retrieval.onerror = () => {
                    logger.debug(
                        `StorageIndexedDB constructing: No existing DB for ${this.workspace}`,
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
            throw new StorageIsClosedError();
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
            throw new StorageIsClosedError();
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
            throw new StorageIsClosedError();
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
            throw new StorageIsClosedError();
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
            throw new StorageIsClosedError();
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
    // queryDocs(query: Query): inherited

    //--------------------------------------------------
    // SET

    async upsert(doc: Doc): Promise<Doc> {
        if (this._isClosed) {
            throw new StorageIsClosedError();
        }
        let upsertedDoc = await super.upsert(doc);

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
