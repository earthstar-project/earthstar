import { Doc, WorkspaceAddress } from "../util/doc-types.ts";
import { EarthstarError, StorageIsClosedError, ValidationError } from "../util/errors.ts";
import { IStorageDriverAsync } from "./storage-types.ts";
import { Sqlite } from "../../deps.ts";

//--------------------------------------------------

import { Logger } from "../util/log.ts";
import { bytesToString, isBytes, stringToBytes } from "../util/bytes.ts";
import { Query } from "../query/query-types.ts";
import { cleanUpQuery } from "../query/query.ts";
import { sortedInPlace } from "./compare.ts";

const logger = new Logger("storage driver sqlite node", "yellow");

interface StorageSqliteOptsCreate {
    mode: "create";
    workspace: WorkspaceAddress;
    filename: string; // must not exist
}
interface StorageSqliteOptsOpen {
    mode: "open";
    workspace: WorkspaceAddress | null;
    filename: string; // must exist
}
interface StorageSqliteOptsCreateOrOpen {
    mode: "create-or-open";
    workspace: WorkspaceAddress;
    filename: string; // may or may not exist
}
export type StorageSqliteNodeOpts =
    | StorageSqliteOptsCreate
    | StorageSqliteOptsOpen
    | StorageSqliteOptsCreateOrOpen;

interface ConfigObject extends Sqlite.RowObject {
    key: string;
    content: string;
}

interface DocObject extends Sqlite.RowObject {
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
}

export class StorageDriverSqlite implements IStorageDriverAsync {
    workspace: WorkspaceAddress;
    _filename: string;
    _isClosed = false;
    _db: Sqlite.DB = null as unknown as Sqlite.DB;
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
            try {
                Deno.removeSync(this._filename);
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

    constructor(opts: StorageSqliteNodeOpts) {
        this._filename = opts.filename;
        this.workspace = "NOT_INITIALIZED";

        // check if file exists
        if (opts.mode === "create") {
            if (opts.filename !== ":memory:") {
                try {
                    // If no file is found, this will throw.
                    Deno.openSync(opts.filename);

                    this.close(false);
                    throw new EarthstarError(
                        `Tried to create an sqlite file but it already exists: ${opts.filename}`,
                    );
                } finally {
                    // Continue as normal
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

        this._db = new Sqlite.DB(this._filename, { memory: this._filename === ":memory:" });
        this._ensureTables();

        const maxLocalIndexQuery = this._db
            .prepareQuery<[number]>(
                `
                SELECT MAX(localIndex) from docs;
        `,
            );

        const [maxLocalIndexFromDb] = maxLocalIndexQuery.one();
        maxLocalIndexQuery.finalize();

        this._maxLocalIndex = maxLocalIndexFromDb || -1;

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
            let existingWorkspace = this._getConfigSync("workspace");

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
        this._db
            .query(
                `
					INSERT OR REPLACE INTO config (key, content) VALUES (:key, :content);
			`,
                { key: key, content: content },
            );

        return Promise.resolve();
    }

    _getConfigSync(key: string): string | undefined {
        const configQuery = this._db
            .prepareQuery<Sqlite.Row, ConfigObject>(
                `SELECT content FROM config WHERE key = :key;`,
            );

        try {
            const row = configQuery.oneEntry({ key });
            const result = row.content;

            logger.debug(
                `getConfig(${JSON.stringify(key)}) = ${JSON.stringify(result)}`,
            );

            return result;
        } catch {
            return undefined;
        } finally {
            configQuery.finalize();
        }
    }

    _listConfigKeysSync(): string[] {
        const keysQuery = this._db
            .prepareQuery<string[]>(
                `
					SELECT key FROM config;
			`,
            );

        const rows = keysQuery.all();

        keysQuery.finalize();

        return sortedInPlace(rows.map(([key]) => key));
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

        this._db
            .query(
                `
					DELETE FROM config WHERE key = :key;
			`,
                { key: key },
            );

        return Promise.resolve(this._db.changes > 0);
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

        const { sql, params } = this._makeDocQuerySql(query, now, "documents");
        logger.debug("  sql:", sql);
        logger.debug("  params:", params);

        const docsQuery = this._db.prepareQuery<Sqlite.Row, DocObject>(sql);

        const docs = docsQuery.allEntries(params);

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

        docsQuery.finalize();
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

        const docWithBytes = {
            ...docWithLocalIndex,
            content: contentAsBytes,
        };

        this._db
            .query(
                `
					INSERT OR REPLACE INTO docs (format, workspace, path, contentHash, content, author, timestamp, deleteAfter, signature, localIndex)
					VALUES (:format, :workspace, :path, :contentHash, :content, :author, :timestamp, :deleteAfter, :signature, :_localIndex);
			`,
                docWithBytes,
            );

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
        this._db.query(`
            PRAGMA encoding = "UTF-8";
            `);

        const encoding = this._db.query(`
        PRAGMA encoding;
        `);

        /*
        if (res !== "UTF-8") {
            throw new Error(
                `sqlite encoding is stubbornly set to ${encoding} instead of UTF-8`,
            );
        }*/

        this._db
            .query(
                `
					CREATE TABLE IF NOT EXISTS docs (
							format TEXT NOT NULL,
							workspace TEXT NOT NULL,
							path TEXT NOT NULL,
							contentHash TEXT NOT NULL,
							content BLOB NOT NULL,
							author TEXT NOT NULL,
							timestamp NUMBER NOT NULL,
							deleteAfter NUMBER,  -- can be null
							signature TEXT NOT NULL,
							localIndex NUMBER NOT NULL UNIQUE,
							PRIMARY KEY(path, author)
					);
			`,
            );

        this._db
            .query(`CREATE INDEX IF NOT EXISTS idx1 ON docs(localIndex);`);

        // the config table is used to store these variables:
        //     workspace - the workspace this store was created for
        //     schemaVersion
        this._db
            .query(
                `
					CREATE TABLE IF NOT EXISTS config (
							key TEXT NOT NULL PRIMARY KEY,
							content TEXT NOT NULL
					);
			`,
            );
    }

    _makeDocQuerySql(
        query: Query,
        now: number,
        mode: "documents" | "delete",
    ): { sql: string; params: Record<string, any> } {
        /**
         * Internal function to make SQL to query for documents or paths,
         * or delete documents matching a query.
         *
         * Assumes query has already been through cleanUpQuery(q).
         *
         * If query.history === 'all', we can do an easy query:
         *
         * ```
         *     SELECT * from DOCS
         *     WHERE path = "/abc"
         *         AND timestamp > 123
         *     ORDER BY path ASC, author ASC
         *     LIMIT 123
         * ```
         *
         * If query.history === 'latest', we have to do something more complicated.
         * We don't want to filter out some docs, and THEN get the latest REMAINING
         * docs in each path.
         * We want to first get the latest doc per path, THEN filter those.
         *
         * ```
         *     SELECT *, MAX(timestamp) from DOCS
         *     -- first level of filtering happens before we choose the latest doc.
         *     -- here we can only do things that are the same for all docs in a path.
         *     WHERE path = "/abc"
         *     -- now group by path and keep the newest one
         *     GROUP BY path
         *     -- finally, second level of filtering happens AFTER we choose the latest doc.
         *     -- these are things that can differ for docs within a path
         *     HAVING timestamp > 123
         *     ORDER BY path ASC, author ASC
         *     LIMIT 123
         * ```
         */

        let select = "";
        let from = "FROM docs";
        let wheres: string[] = [];
        let groupBy = "";
        let havings: string[] = [];
        let orderBy = "";
        let limit = "";

        switch (query.orderBy) {
            case "path ASC":
                //   "path ASC" is actually "path ASC then break ties with timestamp DESC"
                orderBy = "ORDER BY path ASC, timestamp DESC";
                break;
            case "path DESC":
                //   "path DESC" is the reverse of that
                orderBy = "ORDER BY path DESC, timestamp ASC";
                break;
            case "localIndex ASC":
                orderBy = "ORDER BY localIndex ASC";
                break;
            case "localIndex DESC":
                orderBy = "ORDER BY localIndex DESC";
                break;
        }

        const params: Record<string, any> = {};
        let sql = "";

        if (mode === "documents") {
            if (query.historyMode === "all") {
                select = "SELECT *";
            } else if (query.historyMode === "latest") {
                // We're going to GROUP BY path and want to get the doc with the highest timestamp.
                // To break timestamp ties, we'll use the signature.
                // Because we need to look at multiple columns to choose the winner of the group
                // we can't just do MAX(timestamp), we have to do this silly thing instead:
                // TODO: test sorting by signature when timestamp is tied
                select =
                    "SELECT *, MIN(CAST(9999999999999999 - timestamp AS TEXT) || signature) AS toSortWithinPath";
                //select = 'SELECT *, MAX(timestamp) AS toSortWithinPath';
                groupBy = "GROUP BY path";
            } else {
                throw new ValidationError(
                    `unexpected query.historyMode = ${query.historyMode}`,
                );
            }
        } else if (mode === "delete") {
            if (query.historyMode === "all") {
                select = "DELETE";
            } else {
                throw new ValidationError(
                    `query.history must be "all" when doing forgetDocuments`,
                );
            }
        } else {
            // if (mode === 'paths') {

            throw new Error("unknown mode to _makeDocQuerySql: " + mode);
            //select = 'SELECT DISTINCT path';
        }

        // parts of the query that are the same for all docs in a path can go in WHERE.

        if (query.filter?.path !== undefined) {
            wheres.push("path = :path");
            params.path = query.filter.path;
        }
        // If we have pathStartsWith AND pathEndsWith we would want to optimize them
        // into a single filter, path LIKE (:startsWith || '%' || :endsWith).
        // BUT we can't do that because we are allowing the prefix and suffix
        // to potentially overlap,
        // leaving no room in the middle for the wildcard to match anything.
        // So this has to be left as two separate filter clauses.
        if (query.filter?.pathStartsWith !== undefined) {
            // Escape existing % and _ in the prefix so they don't count as wildcards for LIKE.
            // TODO: test this
            wheres.push("path LIKE (:startsWith || '%') ESCAPE '\\'");
            params.startsWith = query.filter.pathStartsWith
                .split("_")
                .join("\\_")
                .split("%")
                .join("\\%");
        }
        if (query.filter?.pathEndsWith !== undefined) {
            // Escape existing % and _ in the suffix so they don't count as wildcards for LIKE.
            // TODO: test this
            wheres.push("path LIKE ('%' || :endsWith) ESCAPE '\\'");
            params.endsWith = query.filter.pathEndsWith
                .split("_")
                .join("\\_")
                .split("%")
                .join("\\%");
        }

        // parts of the query that differ across docs in the same path
        // may have to go in HAVING if we're doing a GROUP BY.
        if (query.filter?.timestamp !== undefined) {
            havings.push("timestamp = :timestamp");
            params.timestamp = query.filter.timestamp;
        }
        if (query.filter?.timestampGt !== undefined) {
            havings.push("timestamp > :timestampGt");
            params.timestampGt = query.filter.timestampGt;
        }
        if (query.filter?.timestampLt !== undefined) {
            havings.push("timestamp < :timestampLt");
            params.timestampLt = query.filter.timestampLt;
        }
        if (query.filter?.author !== undefined) {
            havings.push("author = :author");
            params.author = query.filter.author;
        }
        // Sqlite length() counts unicode characters for TEXT and bytes for BLOB.
        if (query.filter?.contentLength !== undefined) {
            havings.push("length(content) = :contentLength");
            params.contentLength = query.filter.contentLength;
        }
        if (query.filter?.contentLengthGt !== undefined) {
            havings.push("length(content) > :contentLengthGt");
            params.contentLengthGt = query.filter.contentLengthGt;
        }
        if (query.filter?.contentLengthLt !== undefined) {
            havings.push("length(content) < :contentLengthLt");
            params.contentLengthLt = query.filter.contentLengthLt;
        }

        if (query.startAfter !== undefined) {
            if (query.orderBy?.startsWith("path ")) {
                havings.push("path > :continuePath");
                params.continuePath = query.startAfter.path;
            } else if (query.orderBy?.startsWith("localIndex ")) {
                havings.push("localIndex > :continueLocalIndex");
                params.continueLocalIndex = query.startAfter.localIndex;
            }
        }

        if (query.limit !== undefined && mode !== "delete") {
            limit = "LIMIT :limit";
            params.limit = query.limit;
        }

        // limitBytes is skipped here since it can't be expressed in SQL.
        // it's applied after the query is run, and only for docs (not paths).

        // filter out expired docs.
        // to pretend they don't exist at all, we use WHERE instead of HAVING.
        // otherwise they might end up as a latest doc of a group,
        // and then disqualify that group.
        wheres.push("(deleteAfter IS NULL OR :now <= deleteAfter)");
        params.now = now;

        // assemble the final sql

        // in 'all' mode, we don't need to use HAVING, we can do all the filters as WHERE.
        if (query.historyMode === "all") {
            wheres = wheres.concat(havings);
            havings = [];
        }

        const allWheres = wheres.length === 0 ? "" : "WHERE " + wheres.join("\n  AND ");
        const allHavings = havings.length === 0 ? "" : "HAVING " + havings.join("\n  AND ");

        sql = `
					${select}
					${from}
					${allWheres}
					${groupBy}
					${allHavings}
					${orderBy}
					${limit};
			`;

        return { sql, params };
    }
}
