import { Cmp } from "./util-types.ts";
import {
  AuthorAddress,
  AuthorKeypair,
  DocBase,
  DocInputBase,
  FormatName,
  Path,
  ShareAddress,
} from "../util/doc-types.ts";
import { Query } from "../query/query-types.ts";
import {
  IReplicaDriver,
  QuerySourceEvent,
  QuerySourceMode,
  ReplicaEvent,
  ReplicaId,
  ReplicaOpts,
} from "./replica-types.ts";
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
import {
  CallbackSink,
  ChannelMultiStream,
  LockStream,
  OrCh,
} from "../streams/stream_utils.ts";
import { FormatInputType, IFormat } from "../formats/format_types.ts";
import {
  FallbackDoc,
  getFormatsWithFallback,
  OptionalFormats,
  OptionalOriginal,
} from "../formats/default.ts";

import { docMatchesFilter } from "../query/query.ts";

const J = JSON.stringify;
const logger = new Logger("replica", "gold");
const loggerSet = new Logger("replica set", "gold");
const loggerIngest = new Logger("replica ingest", "gold");

//================================================================================

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
export class Replica {
  replicaId: ReplicaId; // todo: save it to the driver too, and reload it when starting up
  /** The address of the share this replica belongs to. */
  share: ShareAddress;
  /** The validator used to validate ingested documents. */
  replicaDriver: IReplicaDriver;

  private _isClosed = false;
  private ingestLockStream = new LockStream();
  private eventMultiStream: ChannelMultiStream<
    ReplicaEvent<DocBase<string>>["kind"],
    "kind",
    ReplicaEvent<DocBase<string>>
  > = new ChannelMultiStream("kind", true);
  private eventWriter: WritableStreamDefaultWriter<
    ReplicaEvent<DocBase<string>>
  >;
  private callbackSink = new CallbackSink<
    ReplicaEvent<DocBase<string>>
  >();
  private eraseInterval: number;

  constructor({ driver }: ReplicaOpts) {
    const addressIsValidResult = checkShareIsValid(driver.docDriver.share);

    if (isErr(addressIsValidResult)) {
      throw addressIsValidResult;
    }

    logger.debug(
      `constructor.  driver = ${(driver as any)?.constructor?.name}`,
    );

    this.replicaId = "replica-" + randomId();
    this.share = driver.docDriver.share;
    this.replicaDriver = driver;

    this.eventWriter = this.eventMultiStream.getWritableStream().getWriter();

    this.eventMultiStream.getReadableStream("*").pipeTo(
      new WritableStream(this.callbackSink),
    );

    this.eraseExpiredDocs();

    this.eraseInterval = setInterval(() => {
      if (!this.isClosed()) {
        this.eraseExpiredDocs();
      } else {
        clearInterval(this.eraseInterval);
      }
    }, 1000 * 60 * 60);
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
    await this.eventWriter.write({
      kind: "willClose",
    });
    logger.debug("    marking self as closed...");
    this._isClosed = true;
    logger.debug(`    closing ReplicaDriver (erase = ${erase})...`);
    await this.replicaDriver.docDriver.close(erase);
    logger.debug("    sending didClose nonblockingly...");
    await this.eventWriter.write({
      kind: "didClose",
    });
    logger.debug("...closing done");
    clearInterval(this.eraseInterval);

    return Promise.resolve();
  }

  //--------------------------------------------------
  // CONFIG

  async getConfig(key: string): Promise<string | undefined> {
    if (this._isClosed) throw new ReplicaIsClosedError();
    return await this.replicaDriver.docDriver.getConfig(key);
  }
  async setConfig(key: string, value: string): Promise<void> {
    if (this._isClosed) throw new ReplicaIsClosedError();
    return await this.replicaDriver.docDriver.setConfig(key, value);
  }
  async listConfigKeys(): Promise<string[]> {
    if (this._isClosed) throw new ReplicaIsClosedError();
    return await this.replicaDriver.docDriver.listConfigKeys();
  }
  async deleteConfig(key: string): Promise<boolean> {
    if (this._isClosed) throw new ReplicaIsClosedError();
    return await this.replicaDriver.docDriver.deleteConfig(key);
  }

  //--------------------------------------------------
  // GET

  /** Returns the max local index of all stored documents */
  getMaxLocalIndex(): number {
    if (this._isClosed) throw new ReplicaIsClosedError();
    return this.replicaDriver.docDriver.getMaxLocalIndex();
  }

  /** Returns all documents, including historical versions of documents by other identities. */
  getAllDocs<F>(
    formats?: OptionalFormats<F>,
  ): Promise<FallbackDoc<F>[]> {
    logger.debug(`getAllDocs()`);

    return this.queryDocs({
      historyMode: "all",
      orderBy: "path ASC",
    }, formats);
  }
  /** Returns latest document from every path. */
  async getLatestDocs<F>(
    formats?: OptionalFormats<F>,
  ): Promise<FallbackDoc<F>[]> {
    logger.debug(`getLatestDocs()`);

    return await this.queryDocs({
      historyMode: "latest",
      orderBy: "path ASC",
    }, formats);
  }
  /** Returns all versions of a document by different authors from a specific path. */
  async getAllDocsAtPath<F>(
    path: Path,
    formats?: OptionalFormats<F>,
  ): Promise<FallbackDoc<F>[]> {
    logger.debug(`getAllDocsAtPath("${path}")`);

    return await this.queryDocs({
      historyMode: "all",
      orderBy: "path ASC",
      filter: { path: path },
    }, formats);
  }
  /** Returns the most recently written version of a document at a path. */
  async getLatestDocAtPath<F>(
    path: Path,
    formats?: OptionalFormats<F>,
  ): Promise<FallbackDoc<F> | undefined> {
    logger.debug(`getLatestDocsAtPath("${path}")`);

    const docs = await this.queryDocs({
      historyMode: "latest",
      orderBy: "path ASC",
      filter: { path: path },
    }, formats);

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
  async queryDocs<F>(
    query: Omit<Query<[string]>, "formats"> = {},
    formats?: OptionalFormats<F>,
  ): Promise<FallbackDoc<F>[]> {
    logger.debug(`queryDocs`, query);
    if (this._isClosed) throw new ReplicaIsClosedError();
    const f = getFormatsWithFallback(formats);
    return await this.replicaDriver.docDriver.queryDocs({
      ...query,
      formats: f.map((f) => f.id),
    }) as FallbackDoc<F>[];
  }

  /** Returns an array of all unique paths of documents returned by a given query. */
  async queryPaths<F>(
    query: Omit<Query<[string]>, "formats"> = {},
    formats?: OptionalFormats<F>,
  ): Promise<Path[]> {
    const docs = await this.queryDocs(query, formats);
    const pathsSet = new Set(docs.map(({ path }) => path));
    return Array.from(pathsSet).sort();
  }

  /** Returns an array of all unique authors of documents returned by a given query. */
  async queryAuthors<F>(
    query: Omit<Query<[string]>, "formats"> = {},
    formats?: OptionalFormats<F>,
  ): Promise<AuthorAddress[]> {
    const docs = await this.queryDocs(query, formats);
    const authorsSet = new Set(docs.map(({ author }) => author));
    return Array.from(authorsSet).sort();
  }

  //--------------------------------------------------
  // SET

  /**
   * Adds a new document to the replica. If a document signed by the same identity exists at the same path, it will be overwritten.
   */

  // The Input type should match the formatter.
  // The default format should be es5
  async set<
    N extends FormatName,
    I extends DocInputBase<N>,
    O extends DocBase<N>,
    FormatType extends IFormat<N, I, O>,
  >(
    keypair: AuthorKeypair,
    format: FormatType,
    docToSet: Omit<FormatInputType<FormatType>, "format">,
  ): Promise<
    true | ValidationError
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

    const result = await format.generateDocument({
      keypair,
      input: { ...docToSet, format: format.id } as unknown as I,
      share: this.share,
      timestamp,
    });

    if (isErr(result)) {
      return result;
    }

    loggerSet.debug("...signature =", result.doc.signature);

    loggerSet.debug("...ingesting");
    loggerSet.debug("-----------------------");
    const ingestEvent = await this.ingest(
      format,
      result.doc,
    );
    loggerSet.debug("-----------------------");
    loggerSet.debug("...done ingesting");
    loggerSet.debug("...set is done.");
    return ingestEvent;
  }

  /**
   * Ingest an existing signed document to the replica.
   */
  async ingest<
    N extends FormatName,
    I extends DocInputBase<N>,
    O extends DocBase<N>,
    FormatType extends IFormat<N, I, O>,
  >(
    format: FormatType,
    docToIngest: O,
  ): Promise<
    true | ValidationError
  > {
    loggerIngest.debug(`ingest`, docToIngest);
    if (this._isClosed) throw new ReplicaIsClosedError();

    loggerIngest.debug("...removing extra fields");

    const removeResultsOrErr = format
      .removeExtraFields(docToIngest);

    if (isErr(removeResultsOrErr)) {
      return removeResultsOrErr;
    }
    docToIngest = removeResultsOrErr.doc; // a copy of doc without extra fields

    const extraFields = removeResultsOrErr.extras; // any extra fields starting with underscores
    if (Object.keys(extraFields).length > 0) {
      loggerIngest.debug(`...extra fields found: ${J(extraFields)}`);
    }

    const docIsValid = format.checkDocumentIsValid(docToIngest);

    if (isErr(docIsValid)) {
      return docIsValid;
    }

    await this.ingestLockStream.run(async () => {
      // get other docs at the same path
      loggerIngest.debug(" >> ingest: start of protected region");
      loggerIngest.debug(
        "  > getting other history docs at the same path by any author",
      );
      const existingDocsSamePath = await this.getAllDocsAtPath(
        docToIngest.path,
        [format] as any,
      );
      loggerIngest.debug(`  > ...got ${existingDocsSamePath.length}`);

      loggerIngest.debug("  > getting prevLatest and prevSameAuthor");
      const prevLatest = existingDocsSamePath[0] ?? null;
      const prevSameAuthor = existingDocsSamePath.filter((d) =>
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
          await this.eventWriter.write({
            kind: "nothing_happened",
            reason: "obsolete_from_same_author",
            doc: docToIngest,
          });
        }
        if (docComp === Cmp.EQ) {
          loggerIngest.debug(
            "  > new doc is EQ prevSameAuthor, so it is redundant (already_had_it)",
          );
          await this.eventWriter.write({
            kind: "nothing_happened",
            reason: "already_had_it",
            doc: docToIngest,
          });
          return;
        }
      }
      // save it
      loggerIngest.debug("  > upserting into ReplicaDriver...");
      const docAsWritten = await this.replicaDriver.docDriver.upsert(
        docToIngest,
      ); // TODO: pass existingDocsSamePath to save another lookup
      loggerIngest.debug("  > ...done upserting into ReplicaDriver");
      loggerIngest.debug("  > ...getting ReplicaDriver maxLocalIndex...");
      const maxLocalIndex = this.replicaDriver.docDriver.getMaxLocalIndex();

      loggerIngest.debug(
        " >> ingest: end of protected region, returning a WriteEvent from the lock",
      );

      await this.eventWriter.write({
        kind: "success",
        maxLocalIndex,
        doc: docAsWritten, // with updated extra properties like _localIndex
        docIsLatest: isLatest,
        prevDocFromSameAuthor: prevSameAuthor,
        prevLatestDoc: prevLatest,
      });
    });

    return true;
  }

  /**
   * Overwrite every document from this author, including history versions, with an empty doc.
    @returns The number of documents changed, or -1 if there was an error.
   */
  async overwriteAllDocsByAuthor<F>(
    keypair: AuthorKeypair,
    formats?: OptionalFormats<F>,
  ): Promise<number | ValidationError> {
    logger.debug(`overwriteAllDocsByAuthor("${keypair.address}")`);
    if (this._isClosed) throw new ReplicaIsClosedError();
    // TODO: do this in batches
    const docsToOverwrite = await this.queryDocs({
      filter: { author: keypair.address },
      historyMode: "all",
    }, formats);
    logger.debug(
      `    ...found ${docsToOverwrite.length} docs to overwrite`,
    );
    let numOverwritten = 0;
    let numAlreadyEmpty = 0;

    const f = getFormatsWithFallback(formats);

    const formatLookup: Record<string, OptionalOriginal<OptionalFormats<F>>> =
      {};

    for (const format of f) {
      formatLookup[format.id] = format as typeof formatLookup[string];
    }

    for (const doc of docsToOverwrite) {
      const format = formatLookup[doc.format];

      if (!format) {
        continue;
      }

      const wipedDoc = await format.wipeDocument(keypair, doc);

      if (isErr(wipedDoc)) return wipedDoc;

      const didIngest = await this.ingest(
        format,
        wipedDoc,
      );

      if (isErr(didIngest)) {
        return didIngest;
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
    const erasedDocs = await this.replicaDriver.docDriver.eraseExpiredDocs();

    for (const doc of erasedDocs) {
      await this.eventWriter.write({
        kind: "expire",
        doc,
      });
    }
  }

  /**
   * Returns a readable stream of replica events, such as new ingestions, document expirations, or the replica preparing to close.
   * @param channel - An optional string representing a channel of events to be subscribed to. Defaults to return all events.
   */
  getEventStream(
    channel: OrCh<ReplicaEvent<DocBase<string>>["kind"]> = "*",
  ): ReadableStream<ReplicaEvent<DocBase<string>>> {
    return this.eventMultiStream.getReadableStream(channel);
  }

  getQueryStream<
    F,
  >(
    query: Omit<Query<[string]>, "formats"> = {},
    formats?: OptionalFormats<F>,
    mode?: QuerySourceMode,
  ): ReadableStream<QuerySourceEvent<FallbackDoc<F>>> {
    const queryDocs = this.queryDocs.bind(this);
    const getEventStream = this.getEventStream.bind(this);

    return new ReadableStream({
      async start(controller) {
        if (mode === "existing" || mode === "everything") {
          const docs = await queryDocs(query, formats);

          for (const doc of docs) {
            controller.enqueue({
              kind: "existing",
              doc: doc,
            });
          }
        }

        controller.enqueue({ kind: "processed_all_existing" });

        if (mode === "existing") {
          controller.close();
          return;
        }

        const eventStream = getEventStream();

        const reader = eventStream.getReader();

        while (true) {
          const { done, value: event } = await reader.read();

          if (done) return;

          if (event.kind === "expire" || event.kind === "success") {
            if (query.filter) {
              if (docMatchesFilter(event.doc, query.filter)) {
                controller.enqueue(event as QuerySourceEvent<FallbackDoc<F>>);
                continue;
              }
            }

            controller.enqueue(event as QuerySourceEvent<FallbackDoc<F>>);
            continue;
          }
        }
      },
    }) as ReadableStream<
      QuerySourceEvent<FallbackDoc<F>>
    >;
  }

  /**
   * Provide a callback to be triggered every time a replica event occurs.
   * @returns A callback which unsubscribes the event.
   */
  onEvent(
    callback: (
      event: ReplicaEvent<DocBase<FormatName>>,
    ) => void | Promise<void>,
  ) {
    return this.callbackSink.onWrite(callback);
  }
}
