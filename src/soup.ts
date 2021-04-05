import {
    Cmp,
    arrayCompare,
} from './utils';

//================================================================================ 

type Thunk = () => void;
type Callback<T> = (data: T) => void;

type Author = string;
type Path = string;
type Signature = string;
type Timestamp = number;
type LocalIndex = number;

interface Doc {
    path: Path,
    timestamp: Timestamp,
    author: Author,
    content: string,
    signature: Signature,
    _localIndex: LocalIndex,  // this is sent over the wire but overwritten by the receiver
}

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

let docIsValid = (doc: Doc): boolean =>
    true;

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
    cb: Callback<Doc>;
    nextIndex: LocalIndex;
}
interface FollowerOpts {
    startAtIndex: LocalIndex,
    //     sync, async blocking, or async non-blocking
}

class Bowl {
    highestLocalIndex: LocalIndex = 0;  // the max local index used so far
    docWithLocalIndex: Map<LocalIndex, Doc> = new Map();
    docWithPathAndAuthor: Map<Path, Doc> = new Map();
    docsByPathNewestFirst: Map<Path, Doc[]> = new Map();  // within each path, sorted newest first

    onWriteCbs: Set<Callback<WriteEvent>> = new Set();
    followers: Set<Follower> = new Set();

    constructor() {
    }

    addFollower(follower: Follower) {
        this.followers.add(follower);

        // catch up
        for (let doc of this.getDocsSinceLocalIndex(follower.nextIndex)) {
            follower.cb(doc);
        }

        return () => this.followers.delete(follower);
    }

    onWrite(cb: Callback<WriteEvent>): Thunk {
        this.onWriteCbs.add(cb);
        return () => this.onWriteCbs.delete(cb);
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

    getAllDocsByPath(path: Path): Doc[] | undefined {
        return this.docsByPathNewestFirst.get(path);
    }
    getLatestDocByPath(path: Path): Doc | undefined {
        let docs = this.docsByPathNewestFirst.get(path);
        if (!docs) { return undefined; }
        return docs[0];
    }

    //--------------------------------------------------
    // SET

    upsert(doc: Doc): UpsertResult {
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

        return upsertResult;
    }
}

