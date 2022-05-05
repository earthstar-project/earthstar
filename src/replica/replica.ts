import { Lock, Superbus } from "../../deps.ts";
import { Cmp } from "./util-types.ts";
import {
  AuthorAddress,
  AuthorKeypair,
  DocBase,
  DocWithFormat,
  FormatName,
  LocalIndex,
  Path,
  ShareAddress,
} from "../util/doc-types.ts";
import { HistoryMode, Query } from "../query/query-types.ts";
import {
  CoreDoc,
  CoreDocInput,
  IngestEvent,
  IReplica,
  IReplicaDriver,
  ReplicaBusChannel,
  ReplicaId,
  ReplicaOpts,
} from "./replica-types.ts";
import {
  FormatValidatorEs4,
} from "../format-validators/format-validator-es4.ts";
import {
  isErr,
  ReplicaIsClosedError,
  ValidationError,
} from "../util/errors.ts";
import { microsecondNow, randomId } from "../util/misc.ts";
import { compareArrays } from "./compare.ts";
import { checkShareIsValid } from "../core-validators/addresses.ts";

//--------------------------------------------------

import { Logger } from "../util/log.ts";
const J = JSON.stringify;
const logger = new Logger("replica", "yellowBright");
const loggerSet = new Logger("replica set", "yellowBright");
const loggerIngest = new Logger("replica ingest", "yellowBright");

//================================================================================

const CORE_VALIDATORS = {
  "es.4": FormatValidatorEs4,
};

function docCompareNewestFirst<
  FormatType extends FormatName,
  DocA extends DocBase<FormatType>,
  DocB extends DocBase<FormatType>,
>(
  a: DocA,
  b: DocB,
): Cmp {
  // Sorts by timestamp DESC (newest fist) and breaks ties using the signature ASC.
  return compareArrays(
    [a.timestamp, a.signature],
    [b.timestamp, a.signature],
    ["DESC", "ASC"],
  );
}

/**
 * A replica of a share's data, used to read, write, and synchronise data to.
 * Should be closed using the `close` method when no longer being used.
 * ```
 * const myReplica = new Replica("+a.a123", Es4Validatior, new ReplicaDriverMemory());
 * ```
 */
export class Replica implements IReplica {
  replicaId: ReplicaId; // todo: save it to the driver too, and reload it when starting up
  /** The address of the share this replica belongs to. */
  share: ShareAddress;
  /** The validator used to validate ingested documents. */
  replicaDriver: IReplicaDriver;
  bus: Superbus<ReplicaBusChannel>;

  private _isClosed = false;
  private ingestLock: Lock<IngestEvent<CoreDoc>>;
  private eraseInterval: number;

  constructor(
    { driver }: ReplicaOpts,
  ) {
    const addressIsValidResult = checkShareIsValid(driver.share);

    if (isErr(addressIsValidResult)) {
      throw addressIsValidResult;
    }

    logger.debug(
      `constructor.  driver = ${(driver as any)?.constructor?.name}`,
    );

    this.replicaId = "replica-" + randomId();
    this.share = driver.share;
    this.replicaDriver = driver;
    this.bus = new Superbus<ReplicaBusChannel>("|");
    this.ingestLock = new Lock<IngestEvent<CoreDoc>>();

    this.eraseExpiredDocs();

    this.eraseInterval = setInterval(() => {
      if (!this.isClosed()) {
        this.eraseExpiredDocs();
      } else {
        clearInterval(this.eraseInterval);
      }
    });
  }

  //--------------------------------------------------
  // LIFECYCLE

  /** Returns whether the replica is closed or not. */
  isClosed(): boolean {
    return this._isClosed;
  }

  /**
   * Closes the replica, preventing new documents from being ingested or events being emitted.
   * Any methods called after closing will return `ReplicaIsClosedError`.
   * @param erase - Erase the contents of the replica. Defaults to `false`.
   */
  async close(erase: boolean): Promise<void> {
    logger.debug("closing...");
    if (this._isClosed) throw new ReplicaIsClosedError();
    // TODO: do this all in a lock?
    logger.debug("    sending willClose blockingly...");
    await this.bus.sendAndWait("willClose");
    logger.debug("    marking self as closed...");
    this._isClosed = true;
    logger.debug(`    closing ReplicaDriver (erase = ${erase})...`);
    await this.replicaDriver.close(erase);
    logger.debug("    sending didClose nonblockingly...");
    await this.bus.sendAndWait("didClose");
    logger.debug("...closing done");
    clearInterval(this.eraseInterval);

    return Promise.resolve();
  }

  //--------------------------------------------------
  // CONFIG

  async getConfig(key: string): Promise<string | undefined> {
    if (this._isClosed) throw new ReplicaIsClosedError();
    return await this.replicaDriver.getConfig(key);
  }
  async setConfig(key: string, value: string): Promise<void> {
    if (this._isClosed) throw new ReplicaIsClosedError();
    return await this.replicaDriver.setConfig(key, value);
  }
  async listConfigKeys(): Promise<string[]> {
    if (this._isClosed) throw new ReplicaIsClosedError();
    return await this.replicaDriver.listConfigKeys();
  }
  async deleteConfig(key: string): Promise<boolean> {
    if (this._isClosed) throw new ReplicaIsClosedError();
    return await this.replicaDriver.deleteConfig(key);
  }

  //--------------------------------------------------
  // GET

  /** Returns the max local index of all stored documents */
  getMaxLocalIndex(): number {
    if (this._isClosed) throw new ReplicaIsClosedError();
    return this.replicaDriver.getMaxLocalIndex();
  }

  async getDocsAfterLocalIndex(
    historyMode: HistoryMode,
    startAfter: LocalIndex,
    limit?: number,
  ): Promise<CoreDoc[]> {
    logger.debug(
      `getDocsAfterLocalIndex(${historyMode}, ${startAfter}, ${limit})`,
    );
    if (this._isClosed) throw new ReplicaIsClosedError();
    const query: Query = {
      historyMode: historyMode,
      orderBy: "localIndex ASC",
      startAfter: {
        localIndex: startAfter,
      },
      limit,
    };
    return await this.replicaDriver.queryDocs(query);
  }

  /** Returns all documents, including historical versions of documents by other identities. */
  async getAllDocs(): Promise<CoreDoc[]> {
    logger.debug(`getAllDocs()`);
    if (this._isClosed) throw new ReplicaIsClosedError();
    return await this.replicaDriver.queryDocs({
      historyMode: "all",
      orderBy: "path ASC",
    });
  }
  /** Returns latest document from every path. */
  async getLatestDocs(): Promise<CoreDoc[]> {
    logger.debug(`getLatestDocs()`);
    if (this._isClosed) throw new ReplicaIsClosedError();
    return await this.replicaDriver.queryDocs({
      historyMode: "latest",
      orderBy: "path ASC",
    });
  }
  /** Returns all versions of a document by different authors from a specific path. */
  async getAllDocsAtPath(path: Path): Promise<CoreDoc[]> {
    logger.debug(`getAllDocsAtPath("${path}")`);
    if (this._isClosed) throw new ReplicaIsClosedError();
    return await this.replicaDriver.queryDocs({
      historyMode: "all",
      orderBy: "path ASC",
      filter: { path: path },
    });
  }
  /** Returns the most recently written version of a document at a path. */
  async getLatestDocAtPath(
    path: Path,
  ): Promise<
    CoreDoc | undefined
  > {
    logger.debug(`getLatestDocsAtPath("${path}")`);
    if (this._isClosed) throw new ReplicaIsClosedError();
    const docs = await this.replicaDriver.queryDocs({
      historyMode: "latest",
      orderBy: "path ASC",
      filter: { path: path },
    });
    if (docs.length === 0) return undefined;
    return docs[0] as CoreDoc;
  }

  /** Returns an array of docs for a given query.
    ```
    const myQuery = {
      filter: {
        pathEndsWith: ".txt"
      },
      limit: 5,
    };

    const firstFiveTextDocs = await myReplica.queryDocs(myQuery);
    ```
    */
  async queryDocs(query: Query = {}): Promise<CoreDoc[]> {
    logger.debug(`queryDocs`, query);
    if (this._isClosed) throw new ReplicaIsClosedError();
    return await this.replicaDriver.queryDocs(query);
  }

  /** Returns an array of all unique paths of documents returned by a given query. */
  async queryPaths(query?: Query): Promise<Path[]> {
    const docs = await this.queryDocs(query);
    const pathsSet = new Set(docs.map(({ path }) => path));
    return Array.from(pathsSet).sort();
  }

  /** Returns an array of all unique authors of documents returned by a given query. */
  async queryAuthors(query?: Query): Promise<AuthorAddress[]> {
    const docs = await this.queryDocs(query);
    const authorsSet = new Set(docs.map(({ author }) => author));
    return Array.from(authorsSet).sort();
  }

  //--------------------------------------------------
  // SET

  /**
   * Adds a new document to the replica. If a document signed by the same identity exists at the same path, it will be overwritten.
   */
  async set<
    InputType extends CoreDocInput,
    OutputType extends DocWithFormat<InputType["format"], CoreDoc>,
  >(
    keypair: AuthorKeypair,
    docToSet: InputType,
  ): Promise<
    IngestEvent<
      OutputType
    >
  > {
    loggerSet.debug(`set`, docToSet);
    if (this._isClosed) throw new ReplicaIsClosedError();

    loggerSet.debug(
      "...deciding timestamp: getting latest doc at the same path (from any author)",
    );

    const latestDocSamePath = await this.getLatestDocAtPath(docToSet.path);

    let timestamp: number;
    if (typeof docToSet.timestamp === "number") {
      timestamp = docToSet.timestamp;
    } else {
      // bump timestamp if needed to win over existing latest doc at same path

      if (latestDocSamePath === undefined) {
        timestamp = microsecondNow();
      } else {
        timestamp = Math.max(
          microsecondNow(),
          latestDocSamePath.timestamp + 1,
        );
      }
    }

    loggerSet.debug("...signing doc");

    const format = docToSet.format;
    const validator = CORE_VALIDATORS[format];

    // HERE
    // The return type is DocBase. Shouldn't it be the abstract type of the validator?
    const signedDoc = await validator.generateDocument({
      keypair,
      input: docToSet,
      share: this.share,
      timestamp,
    });

    if (isErr(signedDoc)) {
      return {
        kind: "failure",
        reason: "invalid_document",
        err: signedDoc,
        maxLocalIndex: this.replicaDriver.getMaxLocalIndex(),
      };
    }
    loggerSet.debug("...signature =", signedDoc.signature);

    loggerSet.debug("...ingesting");
    loggerSet.debug("-----------------------");
    const ingestEvent = await this.ingest(signedDoc);
    loggerSet.debug("-----------------------");
    loggerSet.debug("...done ingesting");
    loggerSet.debug("...set is done.");
    return ingestEvent as IngestEvent<OutputType>;
  }

  /**
   * Ingest an existing signed document to the replica.
   */
  async ingest<
    DocType extends CoreDoc,
  >(
    docToIngest: DocType,
  ): Promise<
    IngestEvent<DocType>
  > {
    loggerIngest.debug(`ingest`, docToIngest);
    if (this._isClosed) throw new ReplicaIsClosedError();

    loggerIngest.debug("...removing extra fields");

    const docFormat = docToIngest.format;
    const validator = CORE_VALIDATORS[docFormat];

    const removeResultsOrErr = validator.removeExtraFields(
      docToIngest,
    );
    if (isErr(removeResultsOrErr)) {
      return {
        kind: "failure",
        reason: "invalid_document",
        err: removeResultsOrErr,
        maxLocalIndex: this.replicaDriver.getMaxLocalIndex(),
      };
    }
    docToIngest = removeResultsOrErr.doc as DocType; // a copy of doc without extra fields

    const extraFields = removeResultsOrErr.extras; // any extra fields starting with underscores
    if (Object.keys(extraFields).length > 0) {
      loggerIngest.debug(`...extra fields found: ${J(extraFields)}`);
    }

    // now actually check doc validity against core schema
    const docIsValid = validator.checkDocumentIsValid(docToIngest);
    if (isErr(docIsValid)) {
      return {
        kind: "failure",
        reason: "invalid_document",
        err: docIsValid,
        maxLocalIndex: this.replicaDriver.getMaxLocalIndex(),
      };
    }

    const writeToDriverWithLock = async (): Promise<
      IngestEvent<DocType>
    > => {
      // get other docs at the same path
      loggerIngest.debug(" >> ingest: start of protected region");
      loggerIngest.debug(
        "  > getting other history docs at the same path by any author",
      );
      const existingDocsSamePath = await this.getAllDocsAtPath(
        docToIngest.path,
      );
      loggerIngest.debug(`  > ...got ${existingDocsSamePath.length}`);

      loggerIngest.debug("  > getting prevLatest and prevSameAuthor");
      const prevLatest = existingDocsSamePath[0] ?? null;
      const prevSameAuthor =
        existingDocsSamePath.filter((d) =>
          d.author === docToIngest.author
        )[0] ??
          null;

      loggerIngest.debug(
        "  > checking if new doc is latest at this path",
      );
      existingDocsSamePath.push(docToIngest);
      existingDocsSamePath.sort(docCompareNewestFirst);
      const isLatest = existingDocsSamePath[0] === docToIngest;
      loggerIngest.debug(`  > ...isLatest: ${isLatest}`);

      if (!isLatest && prevSameAuthor !== null) {
        loggerIngest.debug(
          "  > new doc is not latest and there is another one from the same author...",
        );
        // check if this is obsolete or redudant from the same author
        const docComp = docCompareNewestFirst(
          docToIngest,
          prevSameAuthor,
        );
        if (docComp === Cmp.GT) {
          loggerIngest.debug(
            "  > new doc is GT prevSameAuthor, so it is obsolete",
          );
          return {
            kind: "nothing_happened",
            reason: "obsolete_from_same_author",
            doc: docToIngest,
            maxLocalIndex: this.replicaDriver.getMaxLocalIndex(),
          };
        }
        if (docComp === Cmp.EQ) {
          loggerIngest.debug(
            "  > new doc is EQ prevSameAuthor, so it is redundant (already_had_it)",
          );
          return {
            kind: "nothing_happened",
            reason: "already_had_it",
            doc: docToIngest,
            maxLocalIndex: this.replicaDriver.getMaxLocalIndex(),
          };
        }
      }

      // save it
      loggerIngest.debug("  > upserting into ReplicaDriver...");
      const docAsWritten = await this.replicaDriver.upsert(docToIngest); // TODO: pass existingDocsSamePath to save another lookup
      loggerIngest.debug("  > ...done upserting into ReplicaDriver");
      loggerIngest.debug("  > ...getting ReplicaDriver maxLocalIndex...");
      const maxLocalIndex = this.replicaDriver.getMaxLocalIndex();

      loggerIngest.debug(
        " >> ingest: end of protected region, returning a WriteEvent from the lock",
      );
      return {
        kind: "success",
        maxLocalIndex,
        doc: docAsWritten, // with updated extra properties like _localIndex
        docIsLatest: isLatest,
        prevDocFromSameAuthor: prevSameAuthor as DocType,
        prevLatestDoc: prevLatest as DocType,
      };
    };

    loggerIngest.debug(" >> ingest: running protected region...");
    const ingestEvent = await this.ingestLock.run(
      writeToDriverWithLock,
    );
    loggerIngest.debug(" >> ingest: ...done running protected region");

    loggerIngest.debug("...send ingest event after releasing the lock");
    loggerIngest.debug("...ingest event:", ingestEvent);
    await this.bus.sendAndWait(
      `ingest|${docToIngest.path}` as unknown as "ingest",
      ingestEvent,
    ); // include the path in the channel even on failures

    return ingestEvent as IngestEvent<DocType>;
  }

  /**
   * Overwrite every document from this author, including history versions, with an empty doc.
    @returns The number of documents changed, or -1 if there was an error.
   */
  async overwriteAllDocsByAuthor(
    keypair: AuthorKeypair,
  ): Promise<number | ValidationError> {
    logger.debug(`overwriteAllDocsByAuthor("${keypair.address}")`);
    if (this._isClosed) throw new ReplicaIsClosedError();
    // TODO: do this in batches
    const docsToOverwrite = await this.queryDocs({
      filter: { author: keypair.address },
      historyMode: "all",
    });
    logger.debug(
      `    ...found ${docsToOverwrite.length} docs to overwrite`,
    );
    let numOverwritten = 0;
    let numAlreadyEmpty = 0;
    for (const doc of docsToOverwrite) {
      const validator = CORE_VALIDATORS[doc.format];

      const wipedDoc = await validator.wipeDocument(keypair, doc);

      if (isErr(wipedDoc)) return wipedDoc;

      const ingestEvent = await this.ingest(
        wipedDoc,
      );
      if (ingestEvent.kind === "failure") {
        return new ValidationError(
          "ingestion error during overwriteAllDocsBySameAuthor: " +
            ingestEvent.reason + ": " + ingestEvent.err,
        );
      }
      if (ingestEvent.kind === "nothing_happened") {
        return new ValidationError(
          "ingestion did nothing during overwriteAllDocsBySameAuthor: " +
            ingestEvent.reason,
        );
      } else {
        // success
        numOverwritten += 1;
      }
    }
    logger.debug(
      `    ...done; ${numOverwritten} overwritten to be empty; ${numAlreadyEmpty} were already empty; out of total ${docsToOverwrite.length} docs`,
    );
    return numOverwritten;
  }

  private async eraseExpiredDocs() {
    const erasedPath = await this.replicaDriver.eraseExpiredDocs();

    for (const path of erasedPath) {
      await this.bus.sendAndWait(
        `expire`,
        path,
      );
    }
  }
}
