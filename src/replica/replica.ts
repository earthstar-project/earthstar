import { Cmp } from "./util-types.ts";
import {
  AuthorAddress,
  AuthorKeypair,
  DocAttachment,
  DocBase,
  DocWithAttachment,
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
import {
  DefaultFormat,
  DefaultFormats,
  FormatArg,
  FormatDocType,
  FormatInputType,
  FormatsArg,
} from "../formats/format_types.ts";
import {
  DEFAULT_FORMAT,
  DEFAULT_FORMATS,
  getFormatLookup,
  getFormatsWithFallback,
} from "../formats/util.ts";

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
 * A replica holding a share's documents and attachments, used to read, write, and synchronise data to.
 * Should be closed using the `close` method when no longer being used.
 * ```
 * const myReplica = new Replica(new ReplicaDriverMemory("+gardens.a37ib9"));
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

    this.eraseInterval = setInterval(() => {
      if (!this.isClosed()) {
        this.pruneExpiredDocsAndAttachments();
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
    if (erase === false) {
      await this.pruneExpiredDocsAndAttachments();
    }

    this._isClosed = true;
    logger.debug(`    closing ReplicaDriver (erase = ${erase})...`);

    await this.replicaDriver.docDriver.close(erase);

    if (erase) {
      await this.replicaDriver.attachmentDriver.wipe();
    }

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
  getAllDocs<F = DefaultFormats>(
    formats?: FormatsArg<F>,
  ): Promise<FormatDocType<F>[]> {
    logger.debug(`getAllDocs()`);

    return this.queryDocs({
      historyMode: "all",
      orderBy: "path ASC",
    }, formats);
  }
  /** Returns latest document from every path. */
  getLatestDocs<F = DefaultFormats>(
    formats?: FormatsArg<F>,
  ): Promise<FormatDocType<F>[]> {
    logger.debug(`getLatestDocs()`);

    return this.queryDocs({
      historyMode: "latest",
      orderBy: "path ASC",
    }, formats);
  }
  /** Returns all versions of a document by different authors from a specific path. */
  getAllDocsAtPath<F = DefaultFormats>(
    path: Path,
    formats?: FormatsArg<F>,
  ): Promise<FormatDocType<F>[]> {
    logger.debug(`getAllDocsAtPath("${path}")`);

    return this.queryDocs({
      historyMode: "all",
      orderBy: "path ASC",
      filter: { path: path },
    }, formats);
  }
  /** Returns the most recently written version of a document at a path. */
  async getLatestDocAtPath<F = DefaultFormat>(
    path: Path,
    format?: FormatArg<F>,
  ): Promise<FormatDocType<F> | undefined> {
    logger.debug(`getLatestDocsAtPath("${path}")`);

    const docs = await this.queryDocs({
      historyMode: "latest",
      orderBy: "path ASC",
      filter: { path: path },
    }, format ? [format] : undefined);

    if (docs.length === 0) return undefined;
    return docs[0] as FormatDocType<F>;
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
  async queryDocs<F = DefaultFormats>(
    query: Omit<Query<[string]>, "formats"> = {},
    formats?: FormatsArg<F>,
  ): Promise<FormatDocType<F>[]> {
    logger.debug(`queryDocs`, query);
    if (this._isClosed) throw new ReplicaIsClosedError();
    const f = getFormatsWithFallback(formats);
    return await this.replicaDriver.docDriver.queryDocs({
      ...query,
      formats: f.map((f) => f.id),
    }) as FormatDocType<F>[];
  }

  /** Returns an array of all unique paths of documents returned by a given query. */
  async queryPaths<F = DefaultFormats>(
    query: Omit<Query<[string]>, "formats"> = {},
    formats?: FormatsArg<F>,
  ): Promise<Path[]> {
    const docs = await this.queryDocs(query, formats);
    const pathsSet = new Set(docs.map(({ path }) => path));
    return Array.from(pathsSet).sort();
  }

  /** Returns an array of all unique authors of documents returned by a given query. */
  async queryAuthors<F = DefaultFormats>(
    query: Omit<Query<[string]>, "formats"> = {},
    formats?: FormatsArg<F>,
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
  async set<F = DefaultFormat>(
    keypair: AuthorKeypair,
    docToSet: Omit<FormatInputType<F>, "format">,
    format: FormatArg<F> = DEFAULT_FORMAT as unknown as FormatArg<F>,
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

    loggerSet.debug("...generating doc");

    let cleanedDoc;

    if (latestDocSamePath) {
      const res = format.removeExtraFields(latestDocSamePath);

      if (!isErr(res)) {
        cleanedDoc = res.doc;
      }
    }

    const result = await format.generateDocument({
      keypair,
      input: { ...docToSet, format: format.id },
      share: this.share,
      timestamp,
      prevLatestDoc: cleanedDoc,
    });

    if (isErr(result)) {
      return result;
    }

    loggerSet.debug("...signature =", result.doc.signature);

    // The result has provided a new attachment for us to ingest.
    // The lack of this does not indicate that no attachment is associated with this doc
    // (it may refer to the attachment from the previous doc)
    if (result.attachment) {
      // Stage the new attachment with the attachment driver.
      const stageResult = await this.replicaDriver.attachmentDriver.stage(
        format.id,
        result.attachment,
      );

      if (isErr(stageResult)) {
        return stageResult;
      }

      // Update the document's attachment fields using the results derived from staging.
      const updatedDocRes = format.updateAttachmentFields(
        result.doc,
        stageResult.size,
        stageResult.hash,
      );

      if (isErr(updatedDocRes)) {
        await stageResult.reject();
        return updatedDocRes;
      }

      // If everything checks out, commit the staged attachment to storage.
      loggerSet.debug("...ingesting attachment");
      loggerSet.debug("-----------------------");
      await stageResult.commit();

      loggerSet.debug("...done ingesting attachment");

      loggerSet.debug("...ingesting");
      loggerSet.debug("-----------------------");

      // And ingest the document.
      const ingestEvent = await this.ingest(
        format,
        updatedDocRes as FormatDocType<F>,
      );
      loggerSet.debug("...done ingesting");

      loggerSet.debug("...set is done.");

      return ingestEvent;
    }

    // We don't need to do anything with attachments, so just ingest the document.
    loggerSet.debug("...ingesting");
    loggerSet.debug("-----------------------");
    const ingestEvent = await this.ingest(
      format,
      result.doc as FormatDocType<F>,
    );
    loggerSet.debug("...done ingesting");

    loggerSet.debug("...set is done.");

    return ingestEvent;
  }

  /**
   * Ingest an existing signed document to the replica.
   */
  async ingest<F = DefaultFormat>(
    format: FormatArg<F>,
    docToIngest: FormatDocType<F>,
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
    docToIngest = removeResultsOrErr.doc as FormatDocType<F>; // a copy of doc without extra fields

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
        [format],
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
  async overwriteAllDocsByAuthor<F = DefaultFormats>(
    keypair: AuthorKeypair,
    formats?: FormatsArg<F>,
  ): Promise<number | ValidationError> {
    logger.debug(`overwriteAllDocsByAuthor("${keypair.address}")`);
    if (this._isClosed) throw new ReplicaIsClosedError();
    // TODO: stream the docs out, overwrite them.
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

    const formatLookup: Record<string, FormatArg<F>> = {};

    for (const format of f) {
      formatLookup[format.id] = format as typeof formatLookup[string];
    }

    for (const doc of docsToOverwrite) {
      const format = formatLookup[doc.format];

      if (!format) {
        continue;
      }

      const didWipe = await this.wipeDocument(keypair, doc, format);

      if (isErr(didWipe)) {
        return didWipe;
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

  /** Wipe all content from a document at a given path, and erase its attachment (if it has one). */
  async wipeDocAtPath<F = DefaultFormat>(
    keypair: AuthorKeypair,
    path: string,
    format: FormatArg<F> = DEFAULT_FORMAT as unknown as FormatArg<F>,
  ): Promise<true | ValidationError> {
    const latestDocAtPath = await this.getLatestDocAtPath(path, format);

    if (!latestDocAtPath) {
      return new ValidationError("No document exists at that path");
    }

    return this.wipeDocument(
      keypair,
      latestDocAtPath as FormatDocType<F>,
      format,
    );
  }

  private async wipeDocument<F>(
    keypair: AuthorKeypair,
    doc: FormatDocType<F>,
    format: FormatArg<F>,
  ) {
    // Check if this document has an attachment by tring to get attachment info.
    const attachmentInfo = format.getAttachmentInfo(doc);

    if (!isErr(attachmentInfo)) {
      // Wipe the attachment.
      // Ignore error indicating no attachment was found.
      const eraseRes = await this.replicaDriver.attachmentDriver.erase(
        format.id,
        attachmentInfo.hash,
      );

      if (!isErr(eraseRes)) {
        await this.eventWriter.write({
          kind: "attachment_prune",
          format: format.id,
          hash: attachmentInfo.hash,
        });
      }
    }

    const docToWipe: FormatDocType<F> = {
      ...doc,
      timestamp: doc.timestamp + 1,
      author: keypair.address,
    };

    const wipedDoc = await format.wipeDocument(keypair, docToWipe);

    if (isErr(wipedDoc)) return wipedDoc;

    const didIngest = await this.ingest(
      format,
      wipedDoc as FormatDocType<F>,
    );

    return didIngest;
  }

  /** Erases expired docs and dangling attachments */
  private async pruneExpiredDocsAndAttachments<F>(
    // Because es5 is the only format with attachments, that's all we'll handle for now.
    formats: FormatsArg<F> = DEFAULT_FORMATS as unknown as FormatsArg<F>,
  ) {
    // Erase expired docs
    const erasedDocs = await this.replicaDriver.docDriver.eraseExpiredDocs();

    for (const doc of erasedDocs) {
      await this.eventWriter.write({
        kind: "expire",
        doc,
      });
    }

    // Erase dangling docs
    const formatLookup = getFormatLookup(formats);

    const allowedHashes: Record<string, Set<string>> = {};

    await this.getQueryStream(
      {
        historyMode: "all",
        orderBy: "localIndex ASC",
      },
      "existing",
      formats,
    ).pipeTo(
      new WritableStream({
        write(event) {
          if (event.kind === "existing") {
            const format = formatLookup[event.doc.format];

            const attachmentInfo = format.getAttachmentInfo(event.doc);

            if (!isErr(attachmentInfo)) {
              const maybeExistingSet = allowedHashes[format.id];

              if (maybeExistingSet) {
                maybeExistingSet.add(attachmentInfo.hash);
              } else {
                allowedHashes[format.id] = new Set([attachmentInfo.hash]);
              }
            }
          }
        },
      }),
    );

    const erasedAttachments = await this.replicaDriver.attachmentDriver.filter(
      allowedHashes,
    );

    for (const attachment of erasedAttachments) {
      await this.eventWriter.write({
        kind: "attachment_prune",
        format: attachment.format,
        hash: attachment.hash,
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

  /**
   * Returns a readable stream of document events which match a given query. The events can represent existing documents, newly ingested documents, or expiring documents.
   */
  getQueryStream<F = DefaultFormats>(
    query: Omit<Query<[string]>, "formats"> = {},
    mode?: QuerySourceMode,
    formats?: FormatsArg<F>,
  ): ReadableStream<QuerySourceEvent<FormatDocType<F>>> {
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
                controller.enqueue(
                  event as QuerySourceEvent<FormatDocType<F>>,
                );
                continue;
              }
            }

            controller.enqueue(event as QuerySourceEvent<FormatDocType<F>>);
            continue;
          }
        }
      },
    }) as ReadableStream<
      QuerySourceEvent<FormatDocType<F>>
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

  //--------------------------------------------------
  // BLOBS

  /**
   * @returns `true` (indicating it was upsert), `false` (indicating this attachment is already in storage), or a `ValidationError` (indicating something went wrong.)
   */
  async ingestAttachment<F = DefaultFormat>(
    format: FormatArg<F>,
    doc: FormatDocType<F>,
    attachment: Uint8Array | ReadableStream<Uint8Array>,
  ): Promise<
    true | false | ValidationError
  > {
    if (this._isClosed) throw new ReplicaIsClosedError();

    const removeResultsOrErr = format
      .removeExtraFields(doc);

    if (isErr(removeResultsOrErr)) {
      return Promise.resolve(removeResultsOrErr);
    }
    doc = removeResultsOrErr.doc as FormatDocType<F>; // a copy of doc without extra fields

    // check doc is valid
    const docIsValid = format.checkDocumentIsValid(doc);

    if (isErr(docIsValid)) {
      return Promise.resolve(docIsValid);
    }

    // Check we don't already have this attachment
    const existingAttachment = await this.getAttachment(doc, format);

    if (existingAttachment && !isErr(existingAttachment)) {
      return false;
    }

    const attachmentInfo = format.getAttachmentInfo(doc);

    if (isErr(attachmentInfo)) {
      // This really shouldn't happen, but...
      return Promise.resolve(attachmentInfo);
    }

    const stageRes = await this.replicaDriver.attachmentDriver
      .stage(
        doc.format,
        attachment,
      );

    if (isErr(stageRes)) {
      return stageRes;
    }

    // Compare the staged attachment's hash and size to what the doc claims it should be.
    if (stageRes.hash !== attachmentInfo.hash) {
      await stageRes.reject();
      return new ValidationError(
        "Attachment's hash did not match the document's",
      );
    }

    if (stageRes.size !== attachmentInfo.size) {
      await stageRes.reject();
      return new ValidationError(
        "Attachment's size did not match the document's",
      );
    }

    // If it all checks out, commit.
    await stageRes.commit();

    await this.eventWriter.write({
      kind: "attachment_ingest",
      doc,
      hash: stageRes.hash,
      size: stageRes.size,
    });

    return true;
  }

  /** Gets an attachment for a given document. Returns a `ValidationError` if the given document can't have an attachment.
   */
  getAttachment<F = DefaultFormat>(
    doc: FormatDocType<F>,
    format: FormatArg<F> = DEFAULT_FORMAT as unknown as FormatArg<F>,
  ): Promise<DocAttachment | undefined | ValidationError> {
    const attachmentInfo = format.getAttachmentInfo(doc);

    if (!isErr(attachmentInfo)) {
      return this.replicaDriver.attachmentDriver.getAttachment(
        doc.format,
        attachmentInfo.hash,
      );
    } else {
      return Promise.resolve(attachmentInfo);
    }
  }

  /** Returns the given array of documents with a new `attachment` property merged in. The value of this property can be:
   * - `DocAttachment`
   * - `undefined` (the associated document can have an attachment, but we don't have a copy)
   * - `ValidationError` (the associated document can't have an attachment)
   */
  addAttachments<F = DefaultFormats>(
    docs: FormatDocType<F>[],
    formats?: FormatsArg<F>,
  ): Promise<
    Awaited<
      DocWithAttachment<FormatDocType<F>>
    >[]
  > {
    const f = getFormatsWithFallback(formats);

    const formatLookup: Record<string, FormatArg<F>> = {};

    for (const format of f) {
      formatLookup[format.id] = format as typeof formatLookup[string];
    }

    const promises = docs.map((doc) => {
      return new Promise<
        FormatDocType<F> & {
          attachment: ValidationError | DocAttachment | undefined;
        }
      >((resolve) => {
        const format = formatLookup[doc.format];

        const attachmentInfo = format.getAttachmentInfo(doc);

        if (!isErr(attachmentInfo)) {
          this.replicaDriver.attachmentDriver.getAttachment(
            doc.format,
            attachmentInfo.hash,
          )
            .then(
              (attachment) => {
                resolve({ ...doc, attachment });
              },
            );
        } else {
          return resolve({
            ...doc,
            attachment: attachmentInfo,
          });
        }
      });
    });

    return Promise.all(promises);
  }
}
