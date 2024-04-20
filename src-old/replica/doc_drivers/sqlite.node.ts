import { DocBase, ShareAddress } from "../../util/doc-types.ts";
import {
  EarthstarError,
  isErr,
  ReplicaIsClosedError,
} from "../../util/errors.ts";
import { IReplicaDocDriver } from "../replica-types.ts";
import {
  CREATE_CONFIG_TABLE_QUERY,
  CREATE_DOCS_TABLE_QUERY,
  CREATE_INDEXES_QUERY,
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
import {
  Database as SqliteDatabase,
  default as sqlite,
} from "https://esm.sh/better-sqlite3?dts";
import * as fs from "https://deno.land/std@0.123.0/node/fs.ts";

//--------------------------------------------------

import { Logger } from "../../util/log.ts";
import { Query } from "../../query/query-types.ts";
import { cleanUpQuery } from "../../query/query.ts";
import { sortedInPlace } from "../compare.ts";
import { checkShareIsValid } from "../../core-validators/addresses.ts";

const logger = new Logger("storage driver sqlite node", "yellow");

/** A strorage driver which persists to SQLite. Works in Deno and browsers. */
export class DocDriverSqlite implements IReplicaDocDriver {
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
      try {
        fs.rmSync(this._filename);
      } catch (err) {
        logger.error("Failed to delete Sqlite file.");
        logger.error(err);
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
    this.ensureTables();

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

  getMaxLocalIndex(): Promise<number> {
    if (this._isClosed) {
      throw new ReplicaIsClosedError();
    }

    return Promise.resolve(this._maxLocalIndex);
  }

  queryDocs(queryToClean: Query<string[]>): Promise<DocBase<string>[]> {
    return Promise.resolve(this.queryDocsSync(queryToClean));
  }

  private queryDocsSync(queryToClean: Query<string[]>): DocBase<string>[] {
    // Query the documents

    logger.debug("queryDocs", queryToClean);
    if (this._isClosed) {
      throw new ReplicaIsClosedError();
    }

    // clean up the query and exit early if possible.
    const { query, willMatch } = cleanUpQuery(queryToClean);
    logger.debug(`    cleanUpQuery.  willMatch = ${willMatch}`);
    if (willMatch === "nothing") {
      return [];
    }
    const now = Date.now() * 1000;

    const { sql, params } = makeDocQuerySql(query, now, "documents");
    logger.debug("  sql:", sql);
    logger.debug("  params:", params);

    const docRows = this._db.prepare(sql).all(params);

    const docs = [];

    for (const row of docRows) {
      const doc = JSON.parse(row.doc);
      docs.push({ ...doc, _localIndex: row.localIndex });
    }

    return docs;
  }

  //--------------------------------------------------
  // SET

  upsert<DocType extends DocBase<string>>(
    doc: DocType,
  ): Promise<DocType> {
    return Promise.resolve(this.upsertSync(doc));
  }

  private upsertSync<DocType extends DocBase<string>>(
    doc: DocType,
  ): DocType {
    // Insert new doc, replacing old doc if there is one
    logger.debug(`upsertDocument(doc.path: ${JSON.stringify(doc.path)})`);

    if (this._isClosed) {
      throw new ReplicaIsClosedError();
    }

    Object.freeze(doc);
    const row = {
      doc: JSON.stringify(doc),
      localIndex: this._maxLocalIndex + 1,
      pathAuthor: `${doc.path} ${doc.author}`,
    };

    this._maxLocalIndex += 1;

    this._db.prepare(UPSERT_DOC_QUERY).run(row);

    return { ...doc, _localIndex: row.localIndex };
  }

  eraseExpiredDocs() {
    if (this._isClosed) {
      throw new ReplicaIsClosedError();
    }

    const now = Date.now() * 1000;

    const docsToWipe = this._db.prepare(
      SELECT_EXPIRED_DOC_QUERY,
    ).all({ now });

    this._db.prepare(DELETE_EXPIRED_DOC_QUERY).run({ now });

    const docs = [];

    for (const row of docsToWipe) {
      docs.push(JSON.parse(row.doc));
    }

    return Promise.resolve(docs);
  }

  //--------------------------------------------------
  // SQL STUFF

  private ensureTables() {
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

    this._db.prepare(CREATE_CONFIG_TABLE_QUERY).run();

    // check and set schemaVersion
    let schemaVersion = this._getConfigSync("schemaVersion");
    logger.log(`constructor    schemaVersion: ${schemaVersion}`);

    let docsToMigrate: DocBase<string>[] = [];

    if (schemaVersion === undefined) {
      schemaVersion = "2";
      this.setConfig("schemaVersion", schemaVersion);
    } else if (schemaVersion !== "2") {
      // MIGRATE.
      docsToMigrate = this.queryDocsSync({
        historyMode: "all",
        orderBy: "localIndex ASC",
      });

      this._db.prepare(`DROP TABLE docs;`).run();
    }

    this._db.prepare(CREATE_DOCS_TABLE_QUERY).run();

    const indexStatements = CREATE_INDEXES_QUERY.split("\n");

    // bettersqlite3 needs a single statement per call to .prepare
    for (const statement of indexStatements) {
      const trimmed = statement.trim();

      if (trimmed.length > 0) {
        this._db.prepare(statement).run();
      }
    }

    for (const doc of docsToMigrate) {
      this.upsertSync(doc);
    }
  }
}
