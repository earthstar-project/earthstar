import { Lock, Superbus } from "../../deps.ts";
import { Cmp } from "./util-types.ts";
import {
  AuthorAddress,
  AuthorKeypair,
  Doc,
  DocToSet,
  LocalIndex,
  Path,
  ShareAddress,
} from "../util/doc-types.ts";
import { HistoryMode, Query } from "../query/query-types.ts";
import {
  IngestEvent,
  IReplica,
  IReplicaDriver,
  ReplicaBusChannel,
  ReplicaId,
} from "./replica-types.ts";
import { IFormatValidator } from "../format-validators/format-validator-types.ts";
import {
  isErr,
  ReplicaIsClosedError,
  ValidationError,
} from "../util/errors.ts";
import { microsecondNow, randomId } from "../util/misc.ts";
import { compareArrays } from "./compare.ts";
import { checkShareIsValid } from "../core-validators/addresses.ts";

import { Crypto } from "../crypto/crypto.ts";

//--------------------------------------------------

import { Logger } from "../util/log.ts";
const J = JSON.stringify;
const logger = new Logger("replica", "gold");
const loggerSet = new Logger("replica set", "gold");
const loggerIngest = new Logger("replica ingest", "gold");

//================================================================================

function docCompareNewestFirst(a: Doc, b: Doc): Cmp {
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
  formatValidator: IFormatValidator;
  replicaDriver: IReplicaDriver;
  bus: Superbus<ReplicaBusChannel>;

  private _isClosed = false;
  private ingestLock: Lock<IngestEvent>;
  private eraseInterval: number;

  constructor(
    share: ShareAddress,
    validator: IFormatValidator,
    driver: IReplicaDriver,
  ) {
    const addressIsValidResult = checkShareIsValid(share);

    if (isErr(addressIsValidResult)) {
      throw addressIsValidResult;
    }

    logger.debug(
      `constructor.  driver = ${(driver as any)?.constructor?.name}`,
    );

    this.replicaId = "replica-" + randomId();
    this.share = share;
    this.formatValidator = validator;
    this.replicaDriver = driver;
    this.bus = new Superbus<ReplicaBusChannel>("|");
    this.ingestLock = new Lock<IngestEvent>();

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
  ): Promise<Doc[]> {
    logger.debug(
      `getDocsAfterLocalIndex(${historyMode}, ${startAfter}, ${limit})`,
    );
    if (this._isClosed) throw new ReplicaIsClosedError();
    let query: Query = {
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
  async getAllDocs(): Promise<Doc[]> {
    logger.debug(`getAllDocs()`);
    if (this._isClosed) throw new ReplicaIsClosedError();
    return await this.replicaDriver.queryDocs({
      historyMode: "all",
      orderBy: "path ASC",
    });
  }
  /** Returns latest document from every path. */
  async getLatestDocs(): Promise<Doc[]> {
    logger.debug(`getLatestDocs()`);
    if (this._isClosed) throw new ReplicaIsClosedError();
    return await this.replicaDriver.queryDocs({
      historyMode: "latest",
      orderBy: "path ASC",
    });
  }
  /** Returns all versions of a document by different authors from a specific path. */
  async getAllDocsAtPath(path: Path): Promise<Doc[]> {
    logger.debug(`getAllDocsAtPath("${path}")`);
    if (this._isClosed) throw new ReplicaIsClosedError();
    return await this.replicaDriver.queryDocs({
      historyMode: "all",
      orderBy: "path ASC",
      filter: { path: path },
    });
  }
  /** Returns the most recently written version of a document at a path. */
  async getLatestDocAtPath(path: Path): Promise<Doc | undefined> {
    logger.debug(`getLatestDocsAtPath("${path}")`);
    if (this._isClosed) throw new ReplicaIsClosedError();
    let docs = await this.replicaDriver.queryDocs({
      historyMode: "latest",
      orderBy: "path ASC",
      filter: { path: path },
    });
    if (docs.length === 0) return undefined;
    return docs[0];
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
  async queryDocs(query: Query = {}): Promise<Doc[]> {
    logger.debug(`queryDocs`, query);
    if (this._isClosed) throw new ReplicaIsClosedError();
    return await this.replicaDriver.queryDocs(query);
  }

  /** Returns an array of all unique paths of documents returned by a given query. */
  async queryPaths(query?: Query) {
    const docs = await this.queryDocs(query);
    const pathsSet = new Set(docs.map(({ path }) => path));
    return Array.from(pathsSet).sort();
  }

  /** Returns an array of all unique authors of documents returned by a given query. */
  async queryAuthors(query?: Query) {
    const docs = await this.queryDocs(query);
    const authorsSet = new Set(docs.map(({ author }) => author));
    return Array.from(authorsSet).sort();
  }

  //--------------------------------------------------
  // SET

  /**
   * Adds a new document to the replica. If a document signed by the same identity exists at the same path, it will be overwritten.
   */
  async set(
    keypair: AuthorKeypair,
    docToSet: DocToSet,
  ): Promise<IngestEvent> {
    loggerSet.debug(`set`, docToSet);
    if (this._isClosed) throw new ReplicaIsClosedError();

    loggerSet.debug(
      "...deciding timestamp: getting latest doc at the same path (from any author)",
    );

    let timestamp: number;
    if (typeof docToSet.timestamp === "number") {
      timestamp = docToSet.timestamp;
      loggerSet.debug(
        "...docToSet already has a timestamp; not changing it from ",
        timestamp,
      );
    } else {
      // bump timestamp if needed to win over existing latest doc at same path
      let latestDocSamePath = await this.getLatestDocAtPath(
        docToSet.path,
      );
      if (latestDocSamePath === undefined) {
        timestamp = microsecondNow();
        loggerSet.debug(
          "...no existing latest doc, setting timestamp to now() =",
          timestamp,
        );
      } else {
        timestamp = Math.max(
          microsecondNow(),
          latestDocSamePath.timestamp + 1,
        );
        loggerSet.debug(
          "...existing latest doc found, bumping timestamp to win if needed =",
          timestamp,
        );
      }
    }

    let doc: Doc = {
      format: "es.4",
      author: keypair.address,
      content: docToSet.content,
      contentHash: await Crypto.sha256base32(docToSet.content),
      deleteAfter: docToSet.deleteAfter ?? null,
      path: docToSet.path,
      timestamp,
      workspace: this.share,
      signature: "?", // signature will be added in just a moment
      // _localIndex will be added during upsert.  it's not needed for the signature.
    };

    loggerSet.debug("...signing doc");
    let signedDoc = await this.formatValidator.signDocument(keypair, doc);
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
    let ingestEvent = await this.ingest(signedDoc);
    loggerSet.debug("-----------------------");
    loggerSet.debug("...done ingesting");
    loggerSet.debug("...set is done.");
    return ingestEvent;
  }

  /**
   * Ingest an existing signed document to the replica.
   */
  async ingest(docToIngest: Doc): Promise<IngestEvent> {
    loggerIngest.debug(`ingest`, docToIngest);
    if (this._isClosed) throw new ReplicaIsClosedError();

    loggerIngest.debug("...removing extra fields");
    let removeResultsOrErr = this.formatValidator.removeExtraFields(
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
    docToIngest = removeResultsOrErr.doc; // a copy of doc without extra fields
    let extraFields = removeResultsOrErr.extras; // any extra fields starting with underscores
    if (Object.keys(extraFields).length > 0) {
      loggerIngest.debug(`...extra fields found: ${J(extraFields)}`);
    }

    // now actually check doc validity against core schema
    let docIsValid = this.formatValidator.checkDocumentIsValid(docToIngest);
    if (isErr(docIsValid)) {
      return {
        kind: "failure",
        reason: "invalid_document",
        err: docIsValid,
        maxLocalIndex: this.replicaDriver.getMaxLocalIndex(),
      };
    }

    let writeToDriverWithLock = async (): Promise<IngestEvent> => {
      // get other docs at the same path
      loggerIngest.debug(" >> ingest: start of protected region");
      loggerIngest.debug(
        "  > getting other history docs at the same path by any author",
      );
      let existingDocsSamePath = await this.getAllDocsAtPath(
        docToIngest.path,
      );
      loggerIngest.debug(`  > ...got ${existingDocsSamePath.length}`);

      loggerIngest.debug("  > getting prevLatest and prevSameAuthor");
      let prevLatest: Doc | null = existingDocsSamePath[0] ?? null;
      let prevSameAuthor: Doc | null =
        existingDocsSamePath.filter((d) =>
          d.author === docToIngest.author
        )[0] ??
          null;

      loggerIngest.debug(
        "  > checking if new doc is latest at this path",
      );
      existingDocsSamePath.push(docToIngest);
      existingDocsSamePath.sort(docCompareNewestFirst);
      let isLatest = existingDocsSamePath[0] === docToIngest;
      loggerIngest.debug(`  > ...isLatest: ${isLatest}`);

      if (!isLatest && prevSameAuthor !== null) {
        loggerIngest.debug(
          "  > new doc is not latest and there is another one from the same author...",
        );
        // check if this is obsolete or redudant from the same author
        let docComp = docCompareNewestFirst(
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
      let docAsWritten = await this.replicaDriver.upsert(docToIngest); // TODO: pass existingDocsSamePath to save another lookup
      loggerIngest.debug("  > ...done upserting into ReplicaDriver");
      loggerIngest.debug("  > ...getting ReplicaDriver maxLocalIndex...");
      let maxLocalIndex = this.replicaDriver.getMaxLocalIndex();

      loggerIngest.debug(
        " >> ingest: end of protected region, returning a WriteEvent from the lock",
      );
      return {
        kind: "success",
        maxLocalIndex,
        doc: docAsWritten, // with updated extra properties like _localIndex
        docIsLatest: isLatest,
        prevDocFromSameAuthor: prevSameAuthor,
        prevLatestDoc: prevLatest,
      };
    };

    loggerIngest.debug(" >> ingest: running protected region...");
    let ingestEvent: IngestEvent = await this.ingestLock.run(
      writeToDriverWithLock,
    );
    loggerIngest.debug(" >> ingest: ...done running protected region");

    loggerIngest.debug("...send ingest event after releasing the lock");
    loggerIngest.debug("...ingest event:", ingestEvent);
    await this.bus.sendAndWait(
      `ingest|${docToIngest.path}` as unknown as "ingest",
      ingestEvent,
    ); // include the path in the channel even on failures

    return ingestEvent;
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
      if (doc.content.length === 0) {
        numAlreadyEmpty += 1;
        continue;
      }

      // remove extra fields
      const cleanedResult = this.formatValidator.removeExtraFields(doc);
      if (isErr(cleanedResult)) return cleanedResult;
      const cleanedDoc = cleanedResult.doc;

      // make new doc which is empty and just barely newer than the original
      const emptyDoc: Doc = {
        ...cleanedDoc,
        content: "",
        contentHash: await Crypto.sha256base32(""),
        timestamp: doc.timestamp + 1,
        signature: "?",
      };

      // sign and ingest it
      const signedDoc = await this.formatValidator.signDocument(
        keypair,
        emptyDoc,
      );
      if (isErr(signedDoc)) return signedDoc;

      const ingestEvent = await this.ingest(signedDoc);
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
