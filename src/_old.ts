//import {
//    AuthorAddress,
//    AuthorKeypair,
//    Doc,
//    DocToSet,
//    Follower,
//    IStorage,
//    LocalIndex,
//    Path,
//    Query,
//    Thunk,
//    IngestResult,
//} from './types';
//import {
//    Cmp,
//    fakeHash,
//    keyComparer,
//    now,
//} from './utils';
//import {
//    combinePathAndAuthor,
//    docCompareForOverwrite,
//    docComparePathThenNewestFirst,
//    docIsValid,
//    signDoc,
//} from './docs';
//import {
//    cleanUpQuery,
//    docMatchesFilter,
//} from './query';
////import {
////    wakeAsyncFollower,
////} from './follower';
//
////================================================================================ 
//
//class Storage implements IStorage {
//    // The max local index used so far.  The first doc will increment this and get index 1.
//    highestLocalIndex: LocalIndex = 0;
//
//    // Our indexes.
//    // These maps all share the same Doc objects, so memory usage is not bad.
//    // The Doc objects are frozen.
//    docWithLocalIndex: Map<LocalIndex, Doc> = new Map();  // localIndx --> doc
//    docWithPathAndAuthor: Map<Path, Doc> = new Map();     // path+author --> doc
//    docsByPathNewestFirst: Map<Path, Doc[]> = new Map();  // path --> array of docs with that path, sorted newest first
//
//    //// Followers
//    //followers: Set<Follower> = new Set();
//
//    constructor() {
//    }
//
//    //--------------------------------------------------
//    // CALLBACKS AND FOLLOWERS
//
//    /*
//    addFollower(follower: Follower): Thunk {
//        follower.state = 'sleeping';
//        this.followers.add(follower);
//
//        if (follower.kind === 'sync') {
//            // catch up now, synchronously
//            follower.state = 'running';
//            for (let doc of this.getDocsSinceLocalIndex(follower.nextIndex)) {
//                follower.cb(doc);
//            }
//            follower.state = 'sleeping';
//        } else {
//            // async followers get started here and will proceed at their own pace
//            wakeAsyncFollower(follower, this);
//        }
//
//        // return an unsubscribe function which also stops the thread
//        return () => {
//            follower.state = 'sleeping';
//            this.followers.delete(follower);
//        }
//    }
//    */
//
//    getDocsSinceLocalIndex(startAt: LocalIndex, limit?: number): Doc[] {
//        // Return an array of docs with locaIndex >= startAt, with up to limit items.
//        // Limit defaults to infinity.
//        let docs = [];
//        for (let ii = startAt; ii <= this.highestLocalIndex; ii++) {
//            let doc = this.docWithLocalIndex.get(ii);
//            if (doc) { docs.push(doc); }
//            if (limit !== undefined && docs.length === limit) {
//                return docs;
//            }
//        }
//        return docs;
//    }
//
//    //--------------------------------------------------
//    // GET
//
//    getAllDocs(sort: boolean = true): Doc[] {
//        // All docs, sorted by path ASC then timestamp DESC.
//        let docs = [...this.docWithLocalIndex.values()];
//        if (sort) {
//            docs.sort(docComparePathThenNewestFirst);
//        }
//        return docs;
//    }
//
//    getLatestDocs(sort: boolean = true): Doc[] {
//        // The latest doc for each path, sorted by path ASC.
//        let docs: Doc[] = [];
//        for (let docArray of this.docsByPathNewestFirst.values()) {
//            docs.push(docArray[0]);
//        }
//        if (sort) {
//            docs.sort(keyComparer('path'));
//        }
//        return docs;
//    }
//
//    getAllDocsAtPath(path: Path): Doc[] | undefined {
//        // All docs at a given path, sorted newest first.
//        return this.docsByPathNewestFirst.get(path);
//    }
//
//    getLatestDocAtPath(path: Path): Doc | undefined {
//        // The one latest doc at a given path.
//        let docs = this.docsByPathNewestFirst.get(path);
//        if (!docs) { return undefined; }
//        return docs[0];
//    }
//
//    queryDocs(optionalQuery?: Query): Doc[] {
//        // Query the documents.
//
//        // clean up the query and exit early if possible.
//        let { query, isValid, willMatch } = cleanUpQuery(optionalQuery || {});
//        if (!isValid || willMatch === 'nothing' || query.limit === 0) { return []; }
//
//        // get history docs or all docs
//        let docs = query.history === 'all'
//            ? this.getAllDocs(false)   // don't sort it here,
//            : this.getLatestDocs(false);  // we'll sort it below
//
//        // orderBy
//        if (query.orderBy?.startsWith('path')) {
//            docs.sort(docComparePathThenNewestFirst);
//        } else if (query.orderBy?.startsWith('localIndex')) {
//            docs.sort(keyComparer('_localIndex'));
//        }
//
//        if (query.orderBy?.endsWith(' DESC')) {
//            docs.reverse();
//        }
//
//        let filteredDocs: Doc[] = [];
//        for (let doc of docs) {
//            // skip ahead until we pass continueAfter
//            if (query.orderBy === 'path ASC') {
//                if (query.startAt !== undefined) {
//                    if (query.startAt.path !== undefined && doc.path < query.startAt.path) { continue; }
//                    // doc.path is now >= startAt.path
//                }
//            }
//            if (query.orderBy === 'path DESC') {
//                if (query.startAt !== undefined) {
//                    if (query.startAt.path !== undefined && doc.path > query.startAt.path) { continue; }
//                    // doc.path is now <= startAt.path (we're descending)
//                }
//            }
//            if (query.orderBy === 'localIndex ASC') {
//                if (query.startAt !== undefined) {
//                    if (query.startAt.localIndex !== undefined && (doc._localIndex || 0) < query.startAt.localIndex) { continue; }
//                    // doc.path is now >= startAt.localIndex
//                }
//            }
//            if (query.orderBy === 'localIndex DESC') {
//                if (query.startAt !== undefined) {
//                    if (query.startAt.localIndex !== undefined && (doc._localIndex || 0) > query.startAt.localIndex) { continue; }
//                    // doc.path is now <= startAt.localIndex (we're descending)
//                }
//            }
//
//            // apply filter: skip docs that don't match
//            if (query.filter && !docMatchesFilter(doc, query.filter)) { continue; }
//            filteredDocs.push(doc);
//
//            // stop when hitting limit
//            if (query.limit !== undefined && filteredDocs.length >= query.limit) { break; }
//
//            // TODO: limitBytes
//        }
//
//        return filteredDocs;
//    }
//
//    queryPaths(optionalQuery?: Query): Path[] {
//        // If query is provided:
//        // - find docs
//        // - get their paths
//        // - remove duplicates
//        // - sort in ascending order by path unless query has orderBy: 'path DESC'
//        // - limit is applied to the doc query, not the final paths (weird)
//        //
//        // If query is NOT provided:
//        // - return all unique paths in ascending order.
//
//        // clean up the query and exit early if possible.
//        let { query, isValid, willMatch } = cleanUpQuery(optionalQuery || {});
//        if (!isValid || willMatch === 'nothing' || query.limit === 0) { return []; }
//
//        let paths: Path[];
//        if (willMatch === 'all' || willMatch == 'all-latest') {
//            // no query
//            // just get list of unique paths
//            paths = [...this.docsByPathNewestFirst.keys()];
//        } else {
//            // query was provided
//            // do the query, extract paths, remove duplicates
//            let docs = this.queryDocs(query);
//            paths = docs.map(doc => doc.path);
//            paths = [...new Set(paths)];
//        }
//        paths.sort();
//        if (query !== undefined && query.orderBy === 'path DESC') {
//            paths.reverse();
//        }
//        return paths;
//    }
//
//    queryAuthors(optionalQuery?: Query): AuthorAddress[] {
//        // If query is provided:
//        // - find docs
//        // - get their author addresses
//        // - remove duplicates
//        // - sort in ascending order by author address
//        // - limit is applied to the doc query, not the final paths (weird)
//        //
//        // If query is NOT provided:
//        // - return all unique author addresses in ascending order.
//
//        // clean up the query and exit early if possible.
//        let { query, isValid, willMatch } = cleanUpQuery(optionalQuery || {});
//        if (!isValid || willMatch === 'nothing' || query.limit === 0) { return []; }
//
//        let authors: Path[];
//        if (willMatch === 'all') {
//            // no query
//            // just get all unique authors from all docs
//            let authorsSet = new Set<AuthorAddress>();
//            for (let doc of this.docWithPathAndAuthor.values()) {
//                authorsSet.add(doc.author);
//            }
//            authors = [...authorsSet];
//        } else {
//            // query was provided
//            // do the query, extract authors, remove duplicates
//            let docs = this.queryDocs(query || {});
//            authors = docs.map(doc => doc.author);
//            authors = [...new Set<AuthorAddress>(authors)];
//        }
//        authors.sort();
//        return authors;
//    }
//
//    //--------------------------------------------------
//    // SET
//
//    set(keypair: AuthorKeypair, docToWrite: DocToSet): IngestResult {
//        // Prepare and sign a locally made doc, then upsert it.
//
//        // Sets the timestamp to now, but then bumps the timestamp ahead
//        // to win over any existing docs from any author.
//        // (This means that one author's writes may have non-monotonic timestamps
//        //  from path to path).
//        let existingDocSamePath = this.getLatestDocAtPath(docToWrite.path);
//        let doc: Doc = {
//            workspace: docToWrite.workspace,
//            path: docToWrite.path,
//            author: keypair.address,
//            content: docToWrite.content,
//            contentHash: fakeHash(docToWrite.content), // TODO: real hash
//            contentLength: Buffer.byteLength(docToWrite.content),
//            timestamp: existingDocSamePath === undefined ? now() : existingDocSamePath.timestamp + 1,
//            signature: '?',  // signature will be added in just a moment
//            // _localIndex will be added during upsert.  it's not needed for the signature.
//        }
//        signDoc(keypair, doc);
//        return this.ingest(doc);
//    }
//
//    ingest(doc: Doc): IngestResult {
//        // Add an already-signed doc obtained from write() or from another peer.
//
//        // This sets doc._localIndex, overwriting the value from elsewhere,
//        // then freezes the doc object.  (All docs stored in this storage are frozen.)
//
//        if (!docIsValid(doc)) { return IngestResult.Invalid; }
//
//        // Check if it wins over same author's previous doc at this path.
//        // If not, it's obsolete or we already have it, and we ignore it.
//        let pathAndAuthor = combinePathAndAuthor(doc);
//        let existingDocSameAuthor = this.docWithPathAndAuthor.get(pathAndAuthor);
//        if (existingDocSameAuthor) {
//            let docComp = docCompareForOverwrite(doc, existingDocSameAuthor);
//            if (docComp === Cmp.LT) { return IngestResult.Obsolete; }
//            if (docComp === Cmp.EQ) { return IngestResult.AlreadyHadIt; }
//        }
//
//        // At this point, either the doc is newer (relative to same path and author)
//        // or there was no existing one with same path and author.
//        // So let's save it.
//
//        // Put into array of existing docs at this path.
//        // Create a new array if needed.
//        let existingDocsSamePath = this.docsByPathNewestFirst.get(doc.path) || [];
//        existingDocsSamePath.push(doc);
//        // And keep the list sorted by timestamp (newest first)
//        existingDocsSamePath.sort(docComparePathThenNewestFirst);
//
//        // Set the localIndex and freeze the doc
//        this.highestLocalIndex += 1;
//        doc._localIndex = this.highestLocalIndex;
//        Object.freeze(doc);
//
//        // Save it into our index Maps
//        this.docWithLocalIndex.set(this.highestLocalIndex, doc);
//        this.docsByPathNewestFirst.set(doc.path, existingDocsSamePath);
//        this.docWithPathAndAuthor.set(pathAndAuthor, doc);
//
//        // Check if it's the new latest doc at this path
//        // so we know the details for the WriteEvent
//        let upsertResult: IngestResult;
//        let previousLatestDoc: Doc | undefined = undefined;
//        if (existingDocsSamePath[0] === doc) {
//            upsertResult = IngestResult.AcceptedAndLatest;
//            if (existingDocsSamePath.length > 1) {
//                previousLatestDoc = existingDocsSamePath[1];
//            }
//        } else {
//            upsertResult = IngestResult.AcceptedButNotLatest;
//        }
//
//        // update followers
//        for (let follower of this.followers) {
//            if (follower.kind === 'sync') {
//                // sync followers run right now
//                follower.nextIndex = this.highestLocalIndex + 1;
//                follower.cb(doc);
//            } else {
//                // wake up async followers that are sleeping.
//                // they will continue at their own pace until they run out of docs to process,
//                // then go to sleep again.
//                if (follower.state === 'sleeping') {
//                    wakeAsyncFollower(follower, this);
//                }
//            }
//        }
//
//        return upsertResult;
//    }
//}
//