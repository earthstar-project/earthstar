import { Doc, ShareAddress } from "../util/doc-types.ts";
import {
  EarthstarError,
  isErr,
  ReplicaIsClosedError,
  ValidationError,
} from "../util/errors.ts";
import { IReplicaDriver } from "./replica-types.ts";
import {
  Database as SqliteDatabase,
  default as sqlite,
} from "https://esm.sh/better-sqlite3?dts";
import * as fs from "https://deno.land/std@0.123.0/node/fs.ts";
import {
  CREATE_CONFIG_TABLE_QUERY,
  CREATE_DOCS_TABLE_QUERY,
  CREATE_LOCAL_INDEX_INDEX_QUERY,
  DELETE_CONFIG_QUERY,
  makeDocQuerySql,
  MAX_LOCAL_INDEX_QUERY,
  ReplicaSqliteOpts,
  SELECT_CONFIG_CONTENT_QUERY,
  SELECT_KEY_CONFIG_QUERY,
  UPSERT_CONFIG_QUERY,
  UPSERT_DOC_QUERY,
} from "./replica-driver-sqlite.shared.ts";

//--------------------------------------------------

import { Logger } from "../util/log.ts";
import { bytesToString, stringToBytes } from "../util/bytes.ts";
import { Query } from "../query/query-types.ts";
import { cleanUpQuery } from "../query/query.ts";
import { sortedInPlace } from "./compare.ts";
import { checkShareIsValid } from "../core-validators/addresses.ts";
const logger = new Logger("storage driver sqlite node", "yellow");

/** A strorage driver which persists to SQLite. Works in Node. */
export class ReplicaDriverSqlite implements IReplicaDriver {
  share: ShareAddress;
  _filename: string;
  _isClosed = false;
  _db: SqliteDatabase = null as unknown as SqliteDatabase;
  _maxLocalIndex: number;

  //--------------------------------------------------
  // LIFECYCLE

  close(erase: boolean): Promise<void> {
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
      if (fs.existsSync(this._filename)) {
        fs.unlinkSync(this._filename);
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
      if (opts.filename !== ":memory:" && fs.existsSync(opts.filename)) {
        this.close(false);
        throw new EarthstarError(
          `Tried to create an sqlite file but it already exists: ${opts.filename}`,
        );
      }
    } else if (opts.mode === "open") {
      // this should also fail if you try to open :memory:
      if (!fs.existsSync(opts.filename)) {
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

    this._db = sqlite(this._filename);
    this._ensureTables();

    const maxLocalIndexFromDb =
      this._db.prepare(MAX_LOCAL_INDEX_QUERY).get()["MAX(localIndex)"];

    // We have to do this because the maxLocalIndexDb could be 0, which is falsy.
    this._maxLocalIndex = maxLocalIndexFromDb !== null
      ? maxLocalIndexFromDb
      : -1;

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
    /* istanbul ignore else */
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
    this._db.prepare(UPSERT_CONFIG_QUERY).run({ key: key, content: content });

    return Promise.resolve();
  }

  _getConfigSync(key: string): string | undefined {
    const row = this._db.prepare(SELECT_CONFIG_CONTENT_QUERY).get({ key: key });
    const result = row === undefined ? undefined : row.content;
    logger.debug(
      `getConfig(${JSON.stringify(key)}) = ${JSON.stringify(result)}`,
    );
    return result;
  }

  _listConfigKeysSync(): string[] {
    const rows = this._db.prepare(SELECT_KEY_CONFIG_QUERY).all();
    return sortedInPlace(rows.map((row) => row.key));
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
    const result = this._db.prepare(DELETE_CONFIG_QUERY).run({ key: key });

    return Promise.resolve(result.changes > 0);
  }

  //--------------------------------------------------
  // GET

  getMaxLocalIndex(): number {
    if (this._isClosed) {
      throw new ReplicaIsClosedError();
    }

    return this._maxLocalIndex;
  }

  queryDocs(queryToClean: Query): Promise<Doc[]> {
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

    const docs = this._db.prepare(sql).all(params);

    if (query.historyMode === "latest") {
      // remove extra field we added to find the winner within each path
      docs.forEach((d) => {
        delete (d as any).toSortWithinPath;
      });
    }

    // TODO: limitBytes, when this is added back to Query

    // Transform the content from the DB (saved as BLOB) back to string
    const docsWithStringContent = docs.map((doc) => ({
      ...doc,
      content: bytesToString(doc.content),
      _localIndex: doc.localIndex,
    }));

    docsWithStringContent.forEach((doc) => delete doc["localIndex"]);
    docsWithStringContent.forEach((doc) => Object.freeze(doc));
    logger.debug(`  result: ${docs.length} docs`);
    return Promise.resolve(docsWithStringContent);
  }

  //--------------------------------------------------
  // SET

  upsert(doc: Doc): Promise<Doc> {
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

    const docWithBuffer = {
      ...docWithLocalIndex,
      content: contentAsBytes,
    };

    this._db.prepare(UPSERT_DOC_QUERY).run(docWithBuffer);

    return Promise.resolve(docWithLocalIndex);
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
    const encoding = this._db.pragma("encoding", { simple: true });
    if (encoding !== "UTF-8") {
      throw new Error(
        `sqlite encoding is stubbornly set to ${encoding} instead of UTF-8`,
      );
    }

    this._db.prepare(CREATE_DOCS_TABLE_QUERY).run();
    this._db.prepare(CREATE_LOCAL_INDEX_INDEX_QUERY).run();

    // the config table is used to store these variables:
    //     share - the share this store was created for
    //     schemaVersion
    this._db.prepare(CREATE_CONFIG_TABLE_QUERY).run();
  }
}
