import { DocBase, Path, ShareAddress } from "../../util/doc-types.ts";
import { ReplicaIsClosedError } from "../../util/errors.ts";
import { DocDriverMemory } from "./memory.ts";

//--------------------------------------------------

import { Logger } from "../../util/log.ts";
let logger = new Logger("storage driver localStorage", "gold");

//================================================================================
type SerializedDriverDocs = {
  byPathAndAuthor: Record<string, DocBase<string>>;
  byPathNewestFirst: Record<Path, DocBase<string>[]>;
  latestDocsByPath: Record<string, DocBase<string>>;
};

function isSerializedDriverDocs(value: any): value is SerializedDriverDocs {
  // check if data we've loaded from localStorage is actually in the format we expect
  if (typeof value !== "object") {
    return false;
  }
  return ("byPathAndAuthor" in value && "byPathNewestFirst" in value);
}

/** A replica driver which perists to LocalStorage, which stores a maximum of five megabytes per domain. If you're storing multiple shares, this limit will be divided among all their replicas.
 * Works in browsers and Deno.
 */
export class DocDriverLocalStorage extends DocDriverMemory {
  _localStorageKeyConfig: string;
  _localStorageKeyDocs: string;

  /**
   * @param share - The address of the share the replica belongs to.
   * @param key - An optional key you can use to differentiate storage for the same share on the same device.
   */
  constructor(share: ShareAddress, key?: string) {
    super(share);
    logger.debug("constructor");

    // each config item starts with this prefix and gets its own entry in localstorage
    this._localStorageKeyConfig = `earthstar:config:${share}${
      key ? `:${key}` : ""
    }`;
    // but all docs are stored together inside this one item, as a giant JSON object
    this._localStorageKeyDocs = `earthstar:documents:${share}${
      key ? `:${key}` : ""
    }`;

    const existingData = localStorage.getItem(this._localStorageKeyDocs);

    if (existingData !== null) {
      logger.debug("...constructor: loading data from localStorage");
      const parsed = JSON.parse(existingData);

      if (!isSerializedDriverDocs(parsed)) {
        console.warn(
          `localStorage data could not be parsed for share ${share}`,
        );
        return;
      }

      this.docByPathAndAuthor = new Map(
        Object.entries(parsed.byPathAndAuthor),
      );
      this.docsByPathNewestFirst = new Map(
        Object.entries(parsed.byPathNewestFirst),
      );
      this.latestDocsByPath = new Map(Object.entries(parsed.latestDocsByPath));

      const localIndexes = Array.from(this.docByPathAndAuthor.values()).map((
        doc,
      ) => doc._localIndex as number);
      this._maxLocalIndex = Math.max(...localIndexes);
    } else {
      logger.debug(
        "...constructor: there was no existing data in localStorage",
      );
    }

    logger.debug("...constructor is done.");
  }

  //--------------------------------------------------
  // LIFECYCLE

  // isClosed(): inherited
  close(erase: boolean) {
    logger.debug("close");
    if (this._isClosed) throw new ReplicaIsClosedError();
    if (erase) {
      logger.debug("...close: and erase");
      this._configKv = {};
      this._maxLocalIndex = -1;
      this.docsByPathNewestFirst.clear();
      this.docByPathAndAuthor.clear();

      logger.debug("...close: erasing localStorage");

      localStorage.removeItem(this._localStorageKeyDocs);
      for (const key of this._listConfigKeysSync()) {
        this._deleteConfigSync(key);
      }
      logger.debug("...close: erasing is done");
    }
    this._isClosed = true;
    logger.debug("...close is done.");

    return Promise.resolve();
  }

  //--------------------------------------------------
  // CONFIG

  // synchronous versions for internal use

  _getConfigSync(key: string): string | undefined {
    if (this._isClosed) throw new ReplicaIsClosedError();
    key = `${this._localStorageKeyConfig}:${key}`;
    let result = localStorage.getItem(key);
    return result === null ? undefined : result;
  }

  _setConfigSync(key: string, value: string): void {
    if (this._isClosed) throw new ReplicaIsClosedError();
    key = `${this._localStorageKeyConfig}:${key}`;
    localStorage.setItem(key, value);
  }

  _listConfigKeysSync(): string[] {
    if (this._isClosed) throw new ReplicaIsClosedError();
    let keys = Object.keys(localStorage)
      .filter((key) => key.startsWith(this._localStorageKeyConfig + ":"))
      .map((key) => key.slice(this._localStorageKeyConfig.length + 1));
    keys.sort();
    return keys;
  }

  _deleteConfigSync(key: string): boolean {
    if (this._isClosed) throw new ReplicaIsClosedError();
    let hadIt = this._getConfigSync(key);
    key = `${this._localStorageKeyConfig}:${key}`;
    localStorage.removeItem(key);
    return hadIt !== undefined;
  }

  // async versions to match the IStorageDriverAsync interface

  async getConfig(key: string): Promise<string | undefined> {
    return this._getConfigSync(key);
  }
  async setConfig(key: string, value: string): Promise<void> {
    return this._setConfigSync(key, value);
  }
  async listConfigKeys(): Promise<string[]> {
    return this._listConfigKeysSync();
  }
  async deleteConfig(key: string): Promise<boolean> {
    return this._deleteConfigSync(key);
  }

  //--------------------------------------------------
  // GET

  // getMaxLocalIndex(): inherited
  // queryDocs(query: Query): inherited

  //--------------------------------------------------
  // SET

  async upsert<FormatType extends string, DocType extends DocBase<FormatType>>(
    doc: DocType,
  ): Promise<DocType> {
    if (this._isClosed) throw new ReplicaIsClosedError();

    const upsertedDoc = await super.upsert(doc);

    // After every upsert, for now, we save everything
    // to localStorage as a single giant JSON attachment.
    // TODO: debounce this, only do it every 1 second or something

    const docsToBeSerialised: SerializedDriverDocs = {
      byPathAndAuthor: Object.fromEntries(this.docByPathAndAuthor),
      byPathNewestFirst: Object.fromEntries(this.docsByPathNewestFirst),
      latestDocsByPath: Object.fromEntries(this.latestDocsByPath),
    };

    localStorage.setItem(
      this._localStorageKeyDocs,
      JSON.stringify(docsToBeSerialised),
    );

    return upsertedDoc;
  }
}
