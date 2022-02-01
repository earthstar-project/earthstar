import { Doc, WorkspaceAddress } from "../util/doc-types.ts";
import { EarthstarError, StorageIsClosedError, ValidationError } from "../util/errors.ts";
import { IStorageDriverAsync } from "./storage-types.ts";
import { Database as SqliteDatabase, default as sqlite } from "https://esm.sh/better-sqlite3?dts";
import * as fs from "https://deno.land/std@0.123.0/node/fs.ts";
import {
    CREATE_CONFIG_TABLE_QUERY,
    CREATE_DOCS_TABLE_QUERY,
    CREATE_LOCAL_INDEX_INDEX_QUERY,
    DELETE_CONFIG_QUERY,
    makeDocQuerySql,
    MAX_LOCAL_INDEX_QUERY,
    SELECT_CONFIG_CONTENT_QUERY,
    SELECT_KEY_CONFIG_QUERY,
    StorageSqliteOpts,
    UPSERT_CONFIG_QUERY,
    UPSERT_DOC_QUERY,
} from "./storage-driver-sqlite.shared.ts";

//--------------------------------------------------

import { Logger } from "../util/log.ts";
import { bytesToString, stringToBytes } from "../util/bytes.ts";
import { Query } from "../query/query-types.ts";
import { cleanUpQuery } from "../query/query.ts";
import { sortedInPlace } from "./compare.ts";
const logger = new Logger("storage driver sqlite node", "yellow");

export class StorageDriverSqlite implements IStorageDriverAsync {
    workspace: WorkspaceAddress;
    _filename: string;
    _isClosed = false;
    _db: SqliteDatabase = null as unknown as SqliteDatabase;
    _maxLocalIndex: number;

    //--------------------------------------------------
    // LIFECYCLE

    close(erase: boolean): Promise<void> {
        logger.debug("close");
        if (this._isClosed) {
            throw new StorageIsClosedError();
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

    constructor(opts: StorageSqliteOpts) {
        this._filename = opts.filename;
        this.workspace = "NOT_INITIALIZED";

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

        this._db = sqlite(this._filename);
        this._ensureTables();

        const maxLocalIndexFromDb = this._db.prepare(MAX_LOCAL_INDEX_QUERY).get();

        this._maxLocalIndex = maxLocalIndexFromDb["MAX(localIndex)"] || -1;

        // check workspace
        if (opts.mode === "create") {
            // workspace is provided; set it into the file which we know didn't exist until just now
            this.workspace = opts.workspace;
            this.setConfig("workspace", this.workspace);
        } else if (opts.mode === "open") {
            // load existing workspace from file, which we know already existed...
            const existingWorkspace = this._getConfigSync("workspace");
            if (existingWorkspace === undefined) {
                this.close(false);
                throw new EarthstarError(
                    `can't open sqlite file with opts.mode="open" because the file doesn't have a workspace saved in its config table. ${opts.filename}`,
                );
            }
            // if it was also provided in opts, assert that it matches the file
            if (
                opts.workspace !== null &&
                opts.workspace !== this._getConfigSync("workspace")
            ) {
                this.close(false);
                throw new EarthstarError(
                    `sqlite with opts.mode="open" wanted workspace ${opts.workspace} but found ${existingWorkspace} in the file ${opts.filename}`,
                );
            }
            this.workspace = existingWorkspace;
        } else if (opts.mode === "create-or-open") {
            // workspace must be provided
            if (opts.workspace === null) {
                this.close(false);
                throw new EarthstarError(
                    'sqlite with opts.mode="create-or-open" must have a workspace provided, not null',
                );
            }
            this.workspace = opts.workspace;

            // existing workspace can be undefined (file may not have existed yet)
            const existingWorkspace = this._getConfigSync("workspace");

            // if there is an existing workspace, it has to match the one given in opts
            if (
                existingWorkspace !== undefined &&
                opts.workspace !== existingWorkspace
            ) {
                this.close(false);
                throw new EarthstarError(
                    `sqlite file had existing workspace ${existingWorkspace} but opts wanted it to be ${opts.workspace} in file ${opts.filename}`,
                );
            }

            // set workspace if it's not set yet
            if (existingWorkspace === undefined) {
                this.setConfig("workspace", opts.workspace);
            }

            this.workspace = opts.workspace;
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
            throw new StorageIsClosedError();
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
            throw new StorageIsClosedError();
        }
        return Promise.resolve(this._getConfigSync(key));
    }

    listConfigKeys(): Promise<string[]> {
        if (this._isClosed) {
            throw new StorageIsClosedError();
        }
        return Promise.resolve(this._listConfigKeysSync());
    }

    deleteConfig(key: string): Promise<boolean> {
        logger.debug(`deleteConfig(${JSON.stringify(key)})`);
        if (this._isClosed) {
            throw new StorageIsClosedError();
        }
        const result = this._db.prepare(DELETE_CONFIG_QUERY).run({ key: key });

        return Promise.resolve(result.changes > 0);
    }

    //--------------------------------------------------
    // GET

    getMaxLocalIndex(): number {
        if (this._isClosed) {
            throw new StorageIsClosedError();
        }

        return this._maxLocalIndex;
    }

    queryDocs(queryToClean: Query): Promise<Doc[]> {
        // Query the documents

        logger.debug("queryDocs", queryToClean);
        if (this._isClosed) {
            throw new StorageIsClosedError();
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
            throw new StorageIsClosedError();
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
            throw new StorageIsClosedError();
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
        //     workspace - the workspace this store was created for
        //     schemaVersion
        this._db.prepare(CREATE_CONFIG_TABLE_QUERY).run();
    }
}
