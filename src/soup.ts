import {
    Cmp,
    arrayCompare,
    uuid,
    hash,
    keyComparer,
    deepEqual,
} from './utils';

//================================================================================ 

let now = () =>
    Date.now() * 1000;

//================================================================================ 
// BASIC TYPES

type Thunk = () => void;
type Callback<T> = (data: T) => void;
type AsyncCallback<T> = (data: T) => Promise<void>;

type AuthorAddress = string;
type Path = string;
type Signature = string;
type Timestamp = number;
type LocalIndex = number;

interface AuthorKeypair {
    address: AuthorAddress,
    secret: string,
}

//================================================================================ 
// DOCUMENTS

interface Doc {
    path: Path,
    timestamp: Timestamp,
    author: AuthorAddress,
    content: string,
    contentHash: string,
    contentLength: number,
    signature: Signature,
    _localIndex?: LocalIndex,  // this is sent over the wire but overwritten by the receiver
}
interface DocToWrite {
    path: Path,
    author: AuthorAddress,
    content: string,
}

//================================================================================ 
// DOCUMENT SORTING AND VALIDATION

let combinePathAndAuthor = (doc: Doc) => {
    return `${doc.path}|${doc.author}`;
}

let docComparePathThenNewestFirst = (a: Doc, b: Doc): Cmp => {
    if (a.signature === b.signature) { return Cmp.EQ; }
    return arrayCompare(
        [a.path, -a.timestamp],
        [b.path, -b.timestamp],
    );
}
let docCompareForOverwrite = (newDoc: Doc, oldDoc: Doc): Cmp => {
    return arrayCompare(
        [newDoc.timestamp, newDoc.signature],
        [oldDoc.timestamp, oldDoc.signature],
    );
}

let signDoc = (doc: Doc): void => {
    doc.signature = 'sig' + uuid();
}

let docIsValid = (doc: Doc): boolean =>
    true;

//================================================================================ 
// EVENTS AND FOLLOWERS

enum UpsertResult {
    Obsolete = -3,
    AlreadyHadIt = -2,
    Invalid = -1,

    AcceptedButNotLatest = 1,
    AcceptedAndLatest = 2,
}

interface WriteEvent {
    // this is only called on a successful write, so upsertResult
    // will only ever be AcceptedButNotLatest or AcceptedAndLatest
    doc: Doc,
    isLatest: boolean,
    previousDocSameAuthor: Doc | undefined;  // same author, whether this is the latest doc at this path or not
    previousLatestDoc: Doc | undefined;  // any author, only if this is the latest doc at this path
}

interface Follower {
    cb: Callback<Doc> | AsyncCallback<Doc>;
    nextIndex: LocalIndex; // this should start at zero
    kind: 'sync' | 'async';
    state?: 'running' | 'sleeping' | 'quitting',
}
let wakeFollower = (follower: Follower, bowl: Bowl) => {
    if (follower.state !== 'sleeping') { throw new Error('to start, follower should have been already sleeping'); }
    follower.state = 'running';
    setImmediate(() => continueFollower(follower, bowl));
}
let continueFollower = async (follower: Follower, bowl: Bowl) => {
    if (follower.state === 'quitting') { return; }
    if (follower.state === 'sleeping') { throw new Error('to continue, follower should have been already running'); }
    if (follower.nextIndex > bowl.highestLocalIndex) {
        // if we run out of docs to process, go to sleep and stop the thread.
        follower.state = 'sleeping';
        return;
    } else {
        // grab up to 30 docs and process them
        let docs = bowl.getDocsSinceLocalIndex(follower.nextIndex, 30);
        for (let doc of docs) {
            await follower.cb(doc);
        }
        // and schedule ourselves to run again in 4ms
        setImmediate(() => continueFollower(follower, bowl));
    }
}


//================================================================================ 
// QUERY

interface QueryFilter {
    path?: Path,
    pathStartsWith?: string,
    pathEndsWith?: string,
    author?: AuthorAddress,
    timestamp?: Timestamp,
    timestampGt?: Timestamp,
    timestampLt?: Timestamp,
    contentLength?: number,
    contentLengthGt?: number,
    contentLengthLt?: number,
}

interface Query {
    // the first option is the default

    // first, limit to latest docs or all docs
    history?: 'latest' | 'all',
    // then iterate in this order
    //   "path ASC" is actually "path ASC then timestamp DESC"
    //   "path DESC" is the reverse of that
    orderBy?: 'path ASC' | 'path DESC' | 'localIndex ASC' | 'localIndex DESC';
    // start iterating at this item
    continueAfter?: {
        // when ordering by localIndex
        localIndex?: number,
        // when ordering by path
        path?: string,
        author?: string,
    }
    // then apply these filters
    filter?: QueryFilter,
    // stop iterating after this number
    limit?: number;
}

let docMatchesFilter = (doc: Doc, filter: QueryFilter): boolean => {
    if (filter.path !== undefined && doc.path !== filter.path) { return false; }
    if (filter.pathStartsWith !== undefined && !doc.path.startsWith(filter.pathStartsWith)) { return false; }
    if (filter.pathEndsWith !== undefined && !doc.path.startsWith(filter.pathEndsWith)) { return false; }
    if (filter.author !== undefined && doc.author !== filter.author) { return false; }
    if (filter.timestamp !== undefined && doc.timestamp !== filter.timestamp) { return false; }
    if (filter.timestampGt !== undefined && !(doc.timestamp > filter.timestampGt)) { return false; }
    if (filter.timestampLt !== undefined && !(doc.timestamp > filter.timestampLt)) { return false; }
    if (filter.contentLength !== undefined && doc.contentLength !== filter.contentLength) { return false; }
    if (filter.contentLengthGt !== undefined && !(doc.contentLength > filter.contentLengthGt)) { return false; }
    if (filter.contentLengthLt !== undefined && !(doc.contentLength > filter.contentLengthLt)) { return false; }
    return true;
}

let defaultQuery: Query = {
    history: 'latest',
    orderBy: 'path ASC',
    continueAfter: undefined,
    limit: undefined,
    filter: undefined,
}


//================================================================================ 

class Bowl {
    highestLocalIndex: LocalIndex = 0;  // the max local index used so far.  first item has index 1.
    docWithLocalIndex: Map<LocalIndex, Doc> = new Map();
    docWithPathAndAuthor: Map<Path, Doc> = new Map();
    docsByPathNewestFirst: Map<Path, Doc[]> = new Map();  // within each path, sorted newest first

    onWriteCbs: Set<Callback<WriteEvent>> = new Set();
    followers: Set<Follower> = new Set();

    constructor() {
    }

    //--------------------------------------------------
    // CALLBACKS AND FOLLOWERS

    onWrite(cb: Callback<WriteEvent>): Thunk {
        this.onWriteCbs.add(cb);
        // return an unsubscribe function
        return () => this.onWriteCbs.delete(cb);
    }

    addFollower(follower: Follower): Thunk {
        follower.state = 'sleeping';
        this.followers.add(follower);

        if (follower.kind === 'sync') {
            // catch up now, synchronously
            follower.state = 'running';
            for (let doc of this.getDocsSinceLocalIndex(follower.nextIndex)) {
                follower.cb(doc);
            }
            follower.state = 'sleeping';
        } else {
            // async followers get started here and will proceed at their own pace
            wakeFollower(follower, this);
        }

        // return an unsubscribe function
        // TODO: this should stop the thread too
        return () => {
            follower.state = 'sleeping';
            this.followers.delete(follower);
        }
    }

    getDocsSinceLocalIndex(startAt: LocalIndex, limit?: number): Doc[] {
        let docs = [];
        for (let ii = startAt; ii <= this.highestLocalIndex; ii++) {
            let doc = this.docWithLocalIndex.get(ii);
            if (doc) { docs.push(doc); }
            if (limit !== undefined && docs.length === limit) {
                return docs;
            }
        }
        return docs;
    }

    //--------------------------------------------------
    // GET

    getAllDocs(sort: boolean = true): Doc[] {
        let docs = [...this.docWithLocalIndex.values()];
        if (sort) {
            docs.sort(docComparePathThenNewestFirst);
        }
        return docs;
    }
    getLatestDocs(sort: boolean = true): Doc[] {
        let docs: Doc[] = [];
        for (let docArray of this.docsByPathNewestFirst.values()) {
            docs.push(docArray[0]);
        }
        if (sort) {
            docs.sort(docComparePathThenNewestFirst);
        }
        return docs;
    }
    getAllDocsAtPath(path: Path): Doc[] | undefined {
        return this.docsByPathNewestFirst.get(path);
    }
    getLatestDocAtPath(path: Path): Doc | undefined {
        let docs = this.docsByPathNewestFirst.get(path);
        if (!docs) { return undefined; }
        return docs[0];
    }
    queryDocs(query?: Query): Doc[] {
        query = { ...defaultQuery, ...query };

        // get history docs or all docs
        let docs = query.history === 'all'
            ? this.getAllDocs(false)   // don't sort it here,
            : this.getLatestDocs(false);  // we'll sort it below

        // orderBy
        if (query.orderBy?.startsWith('path')) {
            docs.sort(docComparePathThenNewestFirst);
        } else if (query.orderBy?.startsWith('localIndex')) {
            docs.sort(keyComparer('_localIndex'));
        }

        if (query.orderBy?.endsWith(' DESC')) {
            docs.reverse();
        }

        let filteredDocs: Doc[] = [];
        for (let doc of docs) {
            // TODO: skip ahead if continueAfter hasn't been passed yet
            // apply filter: skip docs that don't match
            if (query.filter && !docMatchesFilter(doc, query.filter)) { continue; }
            filteredDocs.push(doc);
            // stop when hitting limit
            if (query.limit !== undefined && filteredDocs.length >= query.limit) { break; }
        }

        return filteredDocs;
    }
    queryPaths(query?: Query): Path[] {
        let paths: Path[];
        if (query === undefined || deepEqual(query, {})) {
            paths = [...this.docsByPathNewestFirst.keys()];
        } else {
            let docs = this.queryDocs(query);
            paths = docs.map(doc => doc.path);
            paths = [...new Set(paths)];
        }
        paths.sort();
        return paths;
    }
    queryAuthors(query?: Query): AuthorAddress[] {
        let authors: AuthorAddress[];
        if (query === undefined || deepEqual(query, {})) {
            let authorsSet = new Set<AuthorAddress>();
            for (let doc of this.docWithPathAndAuthor.values()) {
                authorsSet.add(doc.author);
            }
            authors = [...authorsSet];
        } else {
            let docs = this.queryDocs(query || {});
            authors = docs.map(doc => doc.author);
            authors = [...new Set<AuthorAddress>(authors)];
        }
        authors.sort();
        return authors;
    }

    //--------------------------------------------------
    // SET

    write(keypair: AuthorKeypair, docToWrite: DocToWrite): UpsertResult {
        // prepare and sign a doc, then upsert it

        // bump the timestamp to win over any existing docs
        let existingDocSamePath = this.getLatestDocAtPath(docToWrite.path);
        let doc: Doc = {
            path: docToWrite.path,
            timestamp: existingDocSamePath === undefined ? now() : existingDocSamePath.timestamp + 1,
            author: keypair.address,
            content: docToWrite.content,
            contentHash: hash(docToWrite.content),
            contentLength: Buffer.byteLength(docToWrite.content),
            signature: '?',  // signature will be set in just a second
            // _localIndex will be added by upsert
        }
        signDoc(doc);
        return this.upsert(doc);
    }

    upsert(doc: Doc): UpsertResult {
        // add an already-signed doc obtained from somewhere

        // this sets doc._localIndex then freezes the doc object

        if (!docIsValid(doc)) { return UpsertResult.Invalid; }

        // check if it wins over same author's previous doc at this path
        let pathAndAuthor = combinePathAndAuthor(doc);
        let existingDocSameAuthor = this.docWithPathAndAuthor.get(pathAndAuthor);
        if (existingDocSameAuthor) {
            let docComp = docCompareForOverwrite(doc, existingDocSameAuthor);
            if (docComp === Cmp.LT) { return UpsertResult.Obsolete; }
            if (docComp === Cmp.EQ) { return UpsertResult.AlreadyHadIt; }
        }
        // at this point, either the doc is newer (relative to same path and author)
        // or there was no existing one with same path and author.
        // so let's save it.

        // put into list of existing docs at this path and keep the list sorted
        let existingDocsSamePath = this.docsByPathNewestFirst.get(doc.path) || [];
        existingDocsSamePath.push(doc);
        existingDocsSamePath.sort(docComparePathThenNewestFirst);

        // save
        this.docsByPathNewestFirst.set(doc.path, existingDocsSamePath);
        this.docWithPathAndAuthor.set(pathAndAuthor, doc);
        this.highestLocalIndex += 1;
        this.docWithLocalIndex.set(this.highestLocalIndex, doc);

        doc._localIndex = this.highestLocalIndex;
        Object.freeze(doc);

        // check if it was the latest
        let upsertResult: UpsertResult;
        let previousLatestDoc: Doc | undefined = undefined;
        if (existingDocsSamePath[0] === doc) {
            upsertResult = UpsertResult.AcceptedAndLatest;
            if (existingDocsSamePath.length > 1) {
                previousLatestDoc = existingDocsSamePath[1];
            }
        } else {
            upsertResult = UpsertResult.AcceptedButNotLatest;
        }

        // send events
        for (let cb of this.onWriteCbs) {
            cb({
                doc,
                isLatest: upsertResult === UpsertResult.AcceptedAndLatest,
                previousDocSameAuthor: existingDocSameAuthor,
                previousLatestDoc,
            });
        }

        // update followers
        for (let follower of this.followers) {
            if (follower.kind === 'sync') {
                // sync followers run right now
                follower.nextIndex = this.highestLocalIndex + 1;
                follower.cb(doc);
            } else {
                // wake up async followers that are sleeping.
                // they will continue at their own pace until they run out of docs to process,
                // then go to sleep again.
                if (follower.state === 'sleeping') {
                    wakeFollower(follower, this);
                }
            }
        }

        return upsertResult;
    }
}

