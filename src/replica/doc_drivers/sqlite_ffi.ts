import { DocBase, ShareAddress } from "../../util/doc-types.ts";
import {
  EarthstarError,
  isErr,
  ReplicaIsClosedError,
  ValidationError,
} from "../../util/errors.ts";
import { IReplicaDocDriver } from "../replica-types.ts";
import {
  CREATE_CONFIG_TABLE_QUERY,
  CREATE_DOCS_TABLE_QUERY,
  CREATE_LOCAL_INDEX_INDEX_QUERY,
  DELETE_CONFIG_QUERY,
  DELETE_EXPIRED_DOC_QUERY,
  GET_ENCODING_QUERY,
  makeDocQuerySql,
  MAX_LOCAL_INDEX_QUERY,
  ReplicaSqliteOpts,
  SELECT_CONFIG_CONTENT_QUERY,
  SELECT_EXPIRED_DOC_QUERY,
  SELECT_KEY_CONFIG_QUERY,
  SET_ENCODING_QUERY,
  UPSERT_CONFIG_QUERY,
  UPSERT_DOC_QUERY,
} from "./sqlite.shared.ts";
import * as Sqlite from "https://deno.land/x/sqlite3@0.4.2/mod.ts";

//--------------------------------------------------

import { Logger } from "../../util/log.ts";
import { bytesToString, stringToBytes } from "../../util/bytes.ts";
import { Query } from "../../query/query-types.ts";
import { cleanUpQuery } from "../../query/query.ts";
import { sortedInPlace } from "../compare.ts";
import { checkShareIsValid } from "../../core-validators/addresses.ts";
import { DocEs4 } from "../../formats/format_es4.ts";

const logger = new Logger("storage driver sqlite node", "yellow");

type SqlDoc = {
  format: string;
  workspace: string;
  path: string;
  contentHash: string;
  content: Uint8Array;
  author: string;
  timestamp: number;
  deleteAfter: number;
  signature: string;
  localIndex?: number;
  toSortWithinPath?: number;
};

/** A strorage driver which persists to SQLite using native bindings. Works in Deno.
 *
 * *Requires the `--unstable` flag to be passed to Deno when used.*
 */
export class DocDriverSqliteFfi implements IReplicaDocDriver {
  share: ShareAddress;
  _filename: string;
  _isClosed = false;
  _db: Sqlite.Database = null as unknown as Sqlite.Database;
  _maxLocalIndex: number;

  //--------------------------------------------------
  // LIFECYCLE

  async close(erase: boolean): Promise<void> {
    logger.debug("close");
    if (this._isClosed) {
      throw new ReplicaIsClosedError();
    }
    if (this._db) {
      this._db.close();
    }
    // delete the sqlite file
    if (erase === true && this._filename !== ":memory:") {
      logger.log(`...close: and erase`);
      try {
        await Deno.remove(this._filename);
      } catch (err) {
        logger.error("Failed to delete Sqlite file.");
        logger.error(err);
      }

      try {
        await Deno.remove(`${this._filename}-shm`);
      } catch {
        // If it's not there, that's fine.
      }

      try {
        await Deno.remove(`${this._filename}-wal`);
      } catch {
        // If it's not there, that's fine.
      }
    }
    this._isClosed = true;
    logger.debug("...close is done.");

    return Promise.resolve();
  }

  isClosed(): boolean {
    return this._isClosed;
  }

  constructor(opts: ReplicaSqliteOpts) {
    this._filename = opts.filename;
    this.share = "NOT_INITIALIZED";

    // check if file exists
    if (opts.mode === "create") {
      if (opts.filename !== ":memory:") {
        try {
          // If no file is found, this will throw.
          Deno.openSync(opts.filename);

          throw new EarthstarError(
            `Tried to create an sqlite file but it already exists: ${opts.filename}`,
          );
        } catch (err) {
          // Only throw if the error was an Earthstar error thrown by us.
          // Otherwise it's the error thrown by the file not being found. Which is good.
          if (isErr(err)) {
            this.close(false);
            throw err;
          }
        }
      }
    } else if (opts.mode === "open") {
      if (opts.filename === ":memory:") {
        this.close(false);
        throw new EarthstarError(
          `Tried to open :memory: as though it was a file`,
        );
      }

      try {
        Deno.openSync(opts.filename);
      } catch {
        this.close(false);
        throw new EarthstarError(
          `Tried to open an sqlite file but it doesn't exist: ${opts.filename}`,
        );
      }
    } else if (opts.mode === "create-or-open") {
      // file can exist or not.
    } else {
      // unknown mode
      this.close(false);
      throw new EarthstarError(
        `sqlite unrecognized opts.mode: ${(opts as any).mode}`,
      );
    }

    const addressIsValidResult = opts.share
      ? checkShareIsValid(opts.share)
      : true;

    if (isErr(addressIsValidResult)) {
      throw addressIsValidResult;
    }

    this._db = new Sqlite.Database(this._filename, {
      memory: this._filename === ":memory:",
    });
    this._ensureTables();

    const [maxLocalIndexResult] = this._db.queryObject<{
      "MAX(localIndex)": number | null;
    }>(
      MAX_LOCAL_INDEX_QUERY,
    );

    const maxLocalIndex = maxLocalIndexResult["MAX(localIndex)"];

    // We have to do this because the maxLocalIndexDb could be 0, which is falsy.
    this._maxLocalIndex = maxLocalIndex !== null ? maxLocalIndex : -1;

    // check share
    if (opts.mode === "create") {
      // share is provided; set it into the file which we know didn't exist until just now
      this.share = opts.share;
      this.setConfig("share", this.share);
    } else if (opts.mode === "open") {
      // load existing share from file, which we know already existed...
      const existingShare = this._getConfigSync("share");
      if (existingShare === undefined) {
        this.close(false);
        throw new EarthstarError(
          `can't open sqlite file with opts.mode="open" because the file doesn't have a share saved in its config table. ${opts.filename}`,
        );
      }
      // if it was also provided in opts, assert that it matches the file
      if (
        opts.share !== null &&
        opts.share !== this._getConfigSync("share")
      ) {
        this.close(false);
        throw new EarthstarError(
          `sqlite with opts.mode="open" wanted share ${opts.share} but found ${existingShare} in the file ${opts.filename}`,
        );
      }
      this.share = existingShare;
    } else if (opts.mode === "create-or-open") {
      // share must be provided
      if (opts.share === null) {
        this.close(false);
        throw new EarthstarError(
          'sqlite with opts.mode="create-or-open" must have a share provided, not null',
        );
      }
      this.share = opts.share;

      // existing share can be undefined (file may not have existed yet)
      const existingShare = this._getConfigSync("share");

      // if there is an existing share, it has to match the one given in opts
      if (
        existingShare !== undefined &&
        opts.share !== existingShare
      ) {
        this.close(false);
        throw new EarthstarError(
          `sqlite file had existing share ${existingShare} but opts wanted it to be ${opts.share} in file ${opts.filename}`,
        );
      }

      // set share if it's not set yet
      if (existingShare === undefined) {
        this.setConfig("share", opts.share);
      }

      this.share = opts.share;
    }

    // check and set schemaVersion
    let schemaVersion = this._getConfigSync("schemaVersion");
    logger.log(`constructor    schemaVersion: ${schemaVersion}`);

    if (schemaVersion === undefined) {
      schemaVersion = "1";
      this.setConfig("schemaVersion", schemaVersion);
    } else if (schemaVersion !== "1") {
      this.close(false);
      throw new ValidationError(
        `sqlite file ${this._filename} has unknown schema version ${schemaVersion}`,
      );
    }

    // get maxlocalindex
  }

  //--------------------------------------------------
  // CONFIG

  setConfig(key: string, content: string): Promise<void> {
    logger.debug(
      `setConfig(${JSON.stringify(key)} = ${JSON.stringify(content)})`,
    );
    if (this._isClosed) {
      throw new ReplicaIsClosedError();
    }
    this._db.execute(UPSERT_CONFIG_QUERY, { key: key, content: content });

    return Promise.resolve();
  }

  _getConfigSync(key: string): string | undefined {
    const [configQueryResult] = this._db.queryObject<{ content: string }>(
      SELECT_CONFIG_CONTENT_QUERY,
      { key },
    );

    if (configQueryResult) {
      return configQueryResult.content;
    }
  }

  _listConfigKeysSync(): string[] {
    const keysQuery = this._db.queryArray<string[]>(SELECT_KEY_CONFIG_QUERY);

    return sortedInPlace(keysQuery.map(([key]) => key));
  }

  getConfig(key: string): Promise<string | undefined> {
    if (this._isClosed) {
      throw new ReplicaIsClosedError();
    }
    return Promise.resolve(this._getConfigSync(key));
  }

  listConfigKeys(): Promise<string[]> {
    if (this._isClosed) {
      throw new ReplicaIsClosedError();
    }
    return Promise.resolve(this._listConfigKeysSync());
  }

  deleteConfig(key: string): Promise<boolean> {
    logger.debug(`deleteConfig(${JSON.stringify(key)})`);
    if (this._isClosed) {
      throw new ReplicaIsClosedError();
    }

    this._db.execute(DELETE_CONFIG_QUERY, { key: key });

    return Promise.resolve(this._db.changes > 0);
  }

  //--------------------------------------------------
  // GET

  getMaxLocalIndex(): number {
    if (this._isClosed) {
      throw new ReplicaIsClosedError();
    }

    return this._maxLocalIndex;
  }

  queryDocs(queryToClean: Query<string[]>): Promise<DocBase<string>[]> {
    // Query the documents

    logger.debug("queryDocs", queryToClean);
    if (this._isClosed) {
      throw new ReplicaIsClosedError();
    }

    // clean up the query and exit early if possible.
    const { query, willMatch } = cleanUpQuery(queryToClean);
    logger.debug(`    cleanUpQuery.  willMatch = ${willMatch}`);
    if (willMatch === "nothing") {
      return Promise.resolve([]);
    }
    const now = Date.now() * 1000;

    const { sql, params } = makeDocQuerySql(query, now, "documents");
    logger.debug("  sql:", sql);
    logger.debug("  params:", params);

    const docs = this._db.queryObject<SqlDoc>(sql, params);

    if (query.historyMode === "latest") {
      // remove extra field we added to find the winner within each path
      docs.forEach((d) => {
        delete d.toSortWithinPath;
      });
    }

    // TODO: limitBytes, when this is added back to Query

    // Transform the content from the DB (saved as BLOB) back to string

    const docsWithStringContent = docs.map((doc) => ({
      ...doc,
      content: doc.content ? bytesToString(doc.content) : "",
      _localIndex: doc.localIndex,
    }));

    docsWithStringContent.forEach((doc) => delete doc.localIndex);
    docsWithStringContent.forEach((doc) => Object.freeze(doc));
    logger.debug(`  result: ${docs.length} docs`);

    return Promise.resolve(docsWithStringContent);
  }

  //--------------------------------------------------
  // SET

  upsert<DocType extends DocBase<string>>(
    doc: DocType,
  ): Promise<DocType> {
    // Insert new doc, replacing old doc if there is one
    logger.debug(`upsertDocument(doc.path: ${JSON.stringify(doc.path)})`);

    if (this._isClosed) {
      throw new ReplicaIsClosedError();
    }

    Object.freeze(doc);
    const docWithLocalIndex = {
      ...doc,
      _localIndex: this._maxLocalIndex + 1,
    };

    this._maxLocalIndex += 1;

    const contentAsBytes = stringToBytes(doc.content);

    const docWithBytes = {
      ...docWithLocalIndex,
      content: contentAsBytes,
    };

    //  TODOM3: Fix this any type.
    this._db.execute(UPSERT_DOC_QUERY, docWithBytes as any);

    return Promise.resolve(docWithLocalIndex);
  }

  eraseExpiredDocs() {
    if (this._isClosed) {
      throw new ReplicaIsClosedError();
    }

    const now = Date.now() * 1000;

    const docsToDelete = this._db.queryObject<SqlDoc>(
      SELECT_EXPIRED_DOC_QUERY,
      { now },
    );

    const docsWithStringContent = docsToDelete.map((docToDelete) => ({
      ...docToDelete,
      content: docToDelete.content ? bytesToString(docToDelete.content) : "",
      _localIndex: docToDelete.localIndex,
    }));

    docsWithStringContent.forEach((doc) => delete doc.localIndex);
    docsWithStringContent.forEach((doc) => Object.freeze(doc));

    this._db.execute(DELETE_EXPIRED_DOC_QUERY, { now });

    return Promise.resolve(docsWithStringContent);
  }

  //--------------------------------------------------
  // SQL STUFF

  _ensureTables() {
    // for each path and author we can have at most one document

    // TODO: how to tell if we're loading an old sqlite file with old schema?

    if (this._isClosed) {
      throw new ReplicaIsClosedError();
    }

    // make sure sqlite is using utf-8
    this._db.execute(SET_ENCODING_QUERY);
    const [{ encoding }] = this._db.queryObject(GET_ENCODING_QUERY);

    if (encoding !== "UTF-8") {
      throw new Error(
        `sqlite encoding is stubbornly set to ${encoding} instead of UTF-8`,
      );
    }

    this._db.execute(CREATE_DOCS_TABLE_QUERY);
    this._db.execute("pragma journal_mode = WAL");
    this._db.execute("pragma synchronous = normal");
    this._db.execute("pragma temp_store = memory");
    this._db.execute(CREATE_LOCAL_INDEX_INDEX_QUERY);

    // the config table is used to store these variables:
    //     share - the share this store was created for
    //     schemaVersion
    this._db.execute(CREATE_CONFIG_TABLE_QUERY);
  }
}
