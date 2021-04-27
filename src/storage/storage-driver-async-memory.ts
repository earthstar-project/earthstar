import {
    Cmp
} from './util-types';
import {
    Doc,
    LocalIndex,
    Path,
    WorkspaceAddress
} from "../util/doc-types";
import {
    Query
} from "./query-types";
import {
    IStorageDriverAsync
} from "./storage-types";

import {
    arrayCompare,
    keyComparer,
} from './compare';
import {
    cleanUpQuery,
    docMatchesFilter
} from './query';
import {
    Lock
} from './lock';

//--------------------------------------------------

import { Logger } from '../util/log2';
let logger = new Logger('storage driver async memory', 'yellow');

//================================================================================

let combinePathAndAuthor = (doc: Doc) => {
    // This is used as a key into the path&author index
    // It must use a separator character that's not valid in either paths or author addresses
    return `${doc.path}|${doc.author}`;
}

let docComparePathThenNewestFirst = (a: Doc, b: Doc): Cmp => {
    // Sorts docs by path ASC, then breaks ties by timestamp DESC (newest first)
    if (a.signature === b.signature) { return Cmp.EQ; }
    return arrayCompare(
        [a.path, -a.timestamp],
        [b.path, -b.timestamp],
    );
}

export class StorageDriverAsyncMemory implements IStorageDriverAsync {
    workspace: WorkspaceAddress;
    lock: Lock;
    _highestLocalIndex: LocalIndex = 0;
  
    // Our indexes.
    // These maps all share the same Doc objects, so memory usage is not bad.
    // The Doc objects are frozen.
    docWithLocalIndex: Map<LocalIndex, Doc> = new Map(); // localIndex --> doc
    docWithPathAndAuthor: Map<Path, Doc> = new Map(); // path+author --> doc
    docsByPathNewestFirst: Map<Path, Doc[]> = new Map(); // path --> array of docs with that path, sorted newest first
  
    constructor(workspace: WorkspaceAddress) {
        logger.debug('constructor');
        this.workspace = workspace;
        this.lock = new Lock();
    }
  
    getHighestLocalIndex() {
        logger.debug(`getHighestLocalIndex(): it's ${this._highestLocalIndex}`);
        return this._highestLocalIndex;
    }
  
    async _getAllDocs(): Promise<Doc[]> {
        // unsorted
        return [...this.docWithLocalIndex.values()];
    }
    async _getLatestDocs(): Promise<Doc[]> {
        // unsorted
        let docs: Doc[] = [];
        for (let docArray of this.docsByPathNewestFirst.values()) {
            // this array is kept sorted newest-first
            docs.push(docArray[0]);
        }
        return docs;
    }

    async queryDocs(queryToClean: Query): Promise<Doc[]> {
        // Query the documents.

        logger.debug('queryDocs', queryToClean);

        // clean up the query and exit early if possible.
        let { query, willMatch } = cleanUpQuery(queryToClean);
        logger.debug(`    cleanUpQuery.  willMatch = ${willMatch}`);
        if (willMatch === 'nothing') { return []; }

        // get history docs or all docs
        logger.debug(`    getting docs; historyMode = ${query.historyMode}`);
        let docs = query.historyMode === 'all'
            ? await this._getAllDocs()   // don't sort it here,
            : await this._getLatestDocs();  // we'll sort it below

        // orderBy
        logger.debug(`    ordering docs: ${query.orderBy}`);
        if (query.orderBy?.startsWith('path')) {
            docs.sort(docComparePathThenNewestFirst);
        } else if (query.orderBy?.startsWith('localIndex')) {
            docs.sort(keyComparer('_localIndex'));
        }
        if (query.orderBy?.endsWith(' DESC')) {
            docs.reverse();
        }

        let filteredDocs: Doc[] = [];
        logger.debug(`    filtering docs`);
        for (let doc of docs) {
            // skip ahead until we pass continueAfter
            if (query.orderBy === 'path ASC') {
                if (query.startAt !== undefined) {
                    if (query.startAt.path !== undefined && doc.path < query.startAt.path) { continue; }
                    // doc.path is now >= startAt.path
                }
            }
            if (query.orderBy === 'path DESC') {
                if (query.startAt !== undefined) {
                    if (query.startAt.path !== undefined && doc.path > query.startAt.path) { continue; }
                    // doc.path is now <= startAt.path (we're descending)
                }
            }
            if (query.orderBy === 'localIndex ASC') {
                if (query.startAt !== undefined) {
                    if (query.startAt.localIndex !== undefined && (doc._localIndex || 0) < query.startAt.localIndex) { continue; }
                    // doc.path is now >= startAt.localIndex
                }
            }
            if (query.orderBy === 'localIndex DESC') {
                if (query.startAt !== undefined) {
                    if (query.startAt.localIndex !== undefined && (doc._localIndex || 0) > query.startAt.localIndex) { continue; }
                    // doc.path is now <= startAt.localIndex (we're descending)
                }
            }

            // apply filter: skip docs that don't match
            if (query.filter && !docMatchesFilter(doc, query.filter)) { continue; }

            // finally, here's a doc we want
            filteredDocs.push(doc);

            // stop when hitting limit
            if (query.limit !== undefined && filteredDocs.length >= query.limit) {
                logger.debug(`    ....hit limit of ${query.limit}`);
                break;
            }
        }

        logger.debug(`    queryDocs is done: found ${filteredDocs.length} docs`);
        return filteredDocs;
    }
  
    async upsert(doc: Doc): Promise<boolean> {
        this._highestLocalIndex += 1;
        doc._localIndex = this._highestLocalIndex;
        Object.freeze(doc);

        logger.debug('upsert', doc);
  
        // save into our various indexes and data structures

        this.docWithLocalIndex.set(doc._localIndex, doc);

        this.docWithPathAndAuthor.set(combinePathAndAuthor(doc), doc);
  
        let docsByPath = this.docsByPathNewestFirst.get(doc.path) || [];
        docsByPath.push(doc);
        docsByPath.sort(docComparePathThenNewestFirst);
        this.docsByPathNewestFirst.set(doc.path, docsByPath);
  
        return true;
    }
}
