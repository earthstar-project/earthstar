import { Cmp } from "../util-types.ts";
import {
  DocBase,
  LocalIndex,
  Path,
  ShareAddress,
} from "../../util/doc-types.ts";
import { Query } from "../../query/query-types.ts";
import { IReplicaDocDriver } from "../replica-types.ts";
import {
  isErr,
  ReplicaIsClosedError,
  ValidationError,
} from "../../util/errors.ts";

import { compareArrays, compareByObjKey, sortedInPlace } from "../compare.ts";
import {
  cleanUpQuery,
  docIsExpired,
  docMatchesFilter,
} from "../../query/query.ts";

//--------------------------------------------------

import { Logger } from "../../util/log.ts";
import { checkShareIsValid } from "../../core-validators/addresses.ts";

let logger = new Logger("storage driver async memory", "yellow");

//================================================================================

function combinePathAndAuthor<DocType extends DocBase<string>>(doc: DocType) {
  // This is used as a key into the path&author index
  // It must use a separator character that's not valid in either paths or author addresses
  return `${doc.path}|${doc.author}`;
}

function docComparePathASCthenNewestFirst<DocType extends DocBase<string>>(
  a: DocType,
  b: DocType,
): Cmp {
  // Sorts docs by path ASC.
  // Within each paths, sorts by timestamp DESC (newest fist) and breaks ties using the signature ASC.
  return compareArrays(
    [a.path, a.timestamp, a.signature],
    [b.path, b.timestamp, a.signature],
    ["ASC", "DESC", "ASC"],
  );
}

function docComparePathDESCthenNewestFirst<DocType extends DocBase<string>>(
  a: DocType,
  b: DocType,
): Cmp {
  // Sorts docs by path DESC.
  // Within each paths, sorts by timestamp DESC (newest fist) and breaks ties using the signature ASC.
  return compareArrays(
    [a.path, a.timestamp, a.signature],
    [b.path, b.timestamp, a.signature],
    ["DESC", "DESC", "ASC"],
  );
}

/** An in-memory replica driver. Its contents will be lost when it is closed.
 * Works everywhere.
 */
export class DocDriverMemory implements IReplicaDocDriver {
  share: ShareAddress;
  _maxLocalIndex: LocalIndex = -1; // when empty, the max is -1.  when one item is present, starting with index 0, the max is 0
  _isClosed: boolean = false;
  _configKv: Record<string, string> = {};

  // Our indexes.
  // These maps all share the same Doc objects, so memory usage is not bad.
  // The Doc objects are frozen.
  docByPathAndAuthor: Map<string, DocBase<string>> = new Map(); // path+author --> doc
  docsByPathNewestFirst: Map<Path, DocBase<string>[]> = new Map(); // path --> array of docs with that path, sorted newest first
  latestDocsByPath: Map<string, DocBase<string>> = new Map();

  /**
   * @param share - The address of the share the replica belongs to.
   */
  constructor(share: ShareAddress) {
    logger.debug("constructor");

    const addressIsValidResult = checkShareIsValid(share);

    if (isErr(addressIsValidResult)) {
      throw addressIsValidResult;
    }

    this.share = share;
  }

  //--------------------------------------------------
  // LIFECYCLE

  isClosed(): boolean {
    return this._isClosed;
  }
  close(erase: boolean) {
    logger.debug("close");
    if (this._isClosed) throw new ReplicaIsClosedError();
    if (erase) {
      logger.debug("...close: and erase");
      // this is an in-memory store so we don't really need to delete anything,
      // but this might help free up memory for the garbage collector
      this._configKv = {};
      this._maxLocalIndex = -1;
      this.docsByPathNewestFirst.clear();
      this.docByPathAndAuthor.clear();
    }
    this._isClosed = true;
    logger.debug("...close is done.");

    return Promise.resolve();
  }

  //--------------------------------------------------
  // CONFIG

  async getConfig(key: string): Promise<string | undefined> {
    if (this._isClosed) throw new ReplicaIsClosedError();
    return this._configKv[key];
  }
  async setConfig(key: string, value: string): Promise<void> {
    if (this._isClosed) throw new ReplicaIsClosedError();
    this._configKv[key] = value;
  }
  async listConfigKeys(): Promise<string[]> {
    if (this._isClosed) throw new ReplicaIsClosedError();
    return sortedInPlace(Object.keys(this._configKv));
  }
  async deleteConfig(key: string): Promise<boolean> {
    if (this._isClosed) throw new ReplicaIsClosedError();
    let had = (key in this._configKv);
    delete this._configKv[key];
    return had;
  }

  //--------------------------------------------------
  // GET

  getMaxLocalIndex() {
    if (this._isClosed) throw new ReplicaIsClosedError();
    logger.debug(`getMaxLocalIndex(): it's ${this._maxLocalIndex}`);
    return Promise.resolve(this._maxLocalIndex);
  }

  async _getAllDocs(): Promise<DocBase<string>[]> {
    // return in unsorted order
    if (this._isClosed) throw new ReplicaIsClosedError();
    return [...this.docByPathAndAuthor.values()];
  }
  async _getLatestDocs(): Promise<DocBase<string>[]> {
    // return in unsorted order
    if (this._isClosed) throw new ReplicaIsClosedError();

    return Array.from(this.latestDocsByPath.values());
  }

  async queryDocs(
    queryToClean: Query<string[]>,
  ): Promise<DocBase<string>[]> {
    // Query the documents.

    logger.debug("queryDocs", queryToClean);
    if (this._isClosed) throw new ReplicaIsClosedError();

    // clean up the query and exit early if possible.
    const { query, willMatch } = cleanUpQuery(queryToClean);
    logger.debug(`    cleanUpQuery.  willMatch = ${willMatch}`);
    if (willMatch === "nothing") {
      return [];
    }

    if (query.historyMode === "latest" && query.filter?.path) {
      const maybeDoc = this.latestDocsByPath.get(query.filter.path);

      if (
        maybeDoc && maybeDoc.deleteAfter &&
        maybeDoc.deleteAfter < Date.now() * 1000
      ) {
        return [];
      }

      return maybeDoc ? [maybeDoc] : [];
    }

    if (query.historyMode === "all" && query.filter?.path) {
      const maybeDocs = this.docsByPathNewestFirst.get(
        query.filter.path,
      );

      if (maybeDocs) {
        const notExpired = [];

        for (const doc of maybeDocs) {
          if (doc.deleteAfter === null || doc.deleteAfter === undefined) {
            notExpired.push(doc);
          }

          if (doc.deleteAfter && doc.deleteAfter > Date.now() * 1000) {
            notExpired.push(doc);
          }
        }

        return notExpired;
      }

      return [];
    }

    // get history docs or all docs
    logger.debug(`    getting docs; historyMode = ${query.historyMode}`);
    const docs = query.historyMode === "all"
      ? await this._getAllDocs() // don't sort it here,
      : await this._getLatestDocs(); // we'll sort it below

    // sort

    const filteredDocs: DocBase<string>[] = [];
    logger.debug(`    filtering docs`);

    const microNow = Date.now() * 1000;

    for (const doc of docs) {
      // skip ahead until we reach startAfter
      if (query.orderBy === "path ASC") {
        if (query.startAfter !== undefined) {
          if (
            query.startAfter.path !== undefined &&
            doc.path <= query.startAfter.path
          ) {
            continue;
          }
          // doc.path is now > startAfter.path
        }
      }
      if (query.orderBy === "path DESC") {
        if (query.startAfter !== undefined) {
          if (
            query.startAfter.path !== undefined &&
            doc.path >= query.startAfter.path
          ) {
            continue;
          }
          // doc.path is now < startAfter.path (we're descending)
        }
      }
      if (query.orderBy === "localIndex ASC") {
        if (query.startAfter !== undefined) {
          if (
            query.startAfter.localIndex !== undefined &&
            (doc._localIndex ?? 0) <= query.startAfter.localIndex
          ) {
            continue;
          }
          // doc.path is now > startAfter.localIndex
        }
      }
      if (query.orderBy === "localIndex DESC") {
        if (query.startAfter !== undefined) {
          if (
            query.startAfter.localIndex !== undefined &&
            (doc._localIndex ?? 0) >= query.startAfter.localIndex
          ) {
            continue;
          }
          // doc.path is now < startAfter.localIndex (we're descending)
        }
      }

      if (doc.deleteAfter && doc.deleteAfter < microNow) {
        continue;
      }

      // apply filter: skip docs that don't match
      if (query.filter && !docMatchesFilter(doc, query.filter)) continue;

      // finally, here's a doc we want
      filteredDocs.push(doc);
    }

    // orderBy
    logger.debug(`    ordering docs: ${query.orderBy}`);
    if (query.orderBy === "path ASC") {
      filteredDocs.sort(docComparePathASCthenNewestFirst);
    } else if (query.orderBy === "path DESC") {
      filteredDocs.sort(docComparePathDESCthenNewestFirst);
    } else if (query.orderBy === "localIndex ASC") {
      filteredDocs.sort(compareByObjKey("_localIndex", "ASC"));
    } else if (query.orderBy === "localIndex DESC") {
      filteredDocs.sort(compareByObjKey("_localIndex", "DESC"));
    } else if (query.orderBy) {
      throw new ValidationError(
        "unrecognized query orderBy: " + JSON.stringify(query.orderBy),
      );
    }

    // limit
    if (
      query.limit !== undefined && docs.length >= query.limit
    ) {
      return filteredDocs.slice(0, query.limit);
    }

    logger.debug(
      `    queryDocs is done: found ${filteredDocs.length} docs.`,
    );
    return filteredDocs;
  }

  //--------------------------------------------------
  // SET

  upsert<DocType extends DocBase<string>>(
    doc: DocType,
  ): Promise<DocType> {
    // add a doc.  don't enforce any rules on it.
    // overwrite existing doc even if this doc is older.
    // return a copy of the doc, frozen, with _localIndex set.

    if (this._isClosed) throw new ReplicaIsClosedError();

    doc = { ...doc };
    this._maxLocalIndex += 1; // this starts at -1 initially, so the first doc has a localIndex of 0.
    doc._localIndex = this._maxLocalIndex;
    Object.freeze(doc);
    logger.debug("upsert", doc);

    // save into our various indexes and data structures

    this.docByPathAndAuthor.set(combinePathAndAuthor(doc), doc);

    // get list of history docs at this path
    let docsByPath = this.docsByPathNewestFirst.get(doc.path) ?? [];
    // remove existing doc from same author same path
    docsByPath = docsByPath.filter((d) => d.author !== doc.author);
    // add this new doc
    docsByPath.push(doc);
    // sort newest first within this path
    docsByPath.sort(docComparePathASCthenNewestFirst);
    // save the list back to the index
    this.docsByPathNewestFirst.set(doc.path, docsByPath);

    const latestDoc = docsByPath[0];
    this.latestDocsByPath.set(doc.path, latestDoc);

    return Promise.resolve(doc);
  }

  eraseExpiredDocs() {
    const expiredDocs = [];

    for (const [, doc] of this.docByPathAndAuthor) {
      if (docIsExpired(doc)) {
        expiredDocs.push(doc);
      }
    }

    for (const expiredDoc of expiredDocs) {
      this.docsByPathNewestFirst.delete(expiredDoc.path);
      this.latestDocsByPath.delete(expiredDoc.path);
      this.docByPathAndAuthor.delete(combinePathAndAuthor(expiredDoc));
    }

    return Promise.resolve(expiredDocs);
  }
}
