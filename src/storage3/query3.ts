import {
    AuthorAddress,
    Document,
    isErr,
    ValidationError
} from '../util/types';

/*
open questions

    when doing paths(query), is it...
    * doing a cheap query only on the paths column, using path and pathPrefix?
    * or doing a full query also using author, timestamp, etc, then getting unique paths?

    isHead: rename to includeAll?  we rarely want to exclude heads

*/

export type HistoryMode =
    'latest'  // get the overall latest per path (the heads), then apply filters just to those
  | 'all';    // return every individually matching history doc

export interface Query3 {
    // an empty query matches all (latest) documents.
    // each filter in the query further reduces the number of results.
    // the exception is that history = 'latest' by default;
    // set it to 'all' to include old history documents also.

    // filters that affect all documents equally within the same path
    path?: string,
    pathPrefix?: string,

    // filters that differently affect documents within the same path
    timestamp?: number,
    timestamp_gt?: number,
    timestamp_lt?: number,

    author?: AuthorAddress,

    contentLength?: number,  // in bytes as utf-8.  skip sparse documents with null content
    contentLength_gt?: number,
    contentLength_lt?: number,

    // other settings

    history?: HistoryMode,  // default: latest

    limit?: number,
    limitBytes?: number,  // sum of content bytes <= limitBytes (stop as soon as possible)

    // sort?: 'newest' | 'oldest' | 'path',  // default is path ASC, author ASC
    // continueAfter: {path, timestamp, ...signature? author? hash?}
};

interface Query3HistoryAll extends Query3 {
    history: 'all',
}
export type Query3ForForget = Omit<Query3HistoryAll, 'limit' | 'limitBytes'>;
export type Query3NoLimitBytes = Omit<Query3, 'limitBytes'>;


export let validateQuery = (query: Query3): ValidationError | true => {
    if (query.limit !== undefined && query.limit < 0) { return new ValidationError('limit must be >= 0'); }
    if (query.limitBytes !== undefined && query.limitBytes < 0) { return new ValidationError('limitBytes must be >= 0'); }
    if (query.contentLength !== undefined && query.contentLength < 0) { return new ValidationError('contentLength must be >= 0'); }
    if (query.history !== undefined && query.history !== 'all' && query.history !== 'latest') {
        return new ValidationError('unknown history mode: ' + query.history);
    }
    return true;
}

export let cleanUpQuery = (query: Query3): Query3 => {
    let isValid = validateQuery(query);
    if (isErr(isValid)) {
        // if query is invalid, instead return a special query that will never match anything
        console.warn(isValid);
        return { limit: 0 };
    }

    // set defaults
    let q: Query3 = {
        history: 'latest',
        // sort: 'path',

        ...query
    };
    return q;
}

export let stringLengthInBytes = (s: string): number =>
    Buffer.byteLength(s, 'utf-8');

export let queryMatchesDoc = (query: Query3, doc: Document): boolean => {
    // only checks individual document properties,
    // not limit, historyMode, sort, etc

    if (query.path       !== undefined && !(query.path === doc.path)) { return false; }
    if (query.pathPrefix !== undefined && !(doc.path.startsWith(query.pathPrefix))) { return false; }

    if (query.timestamp    !== undefined && !(doc.timestamp === query.timestamp   )) { return false; }
    if (query.timestamp_gt !== undefined && !(doc.timestamp >   query.timestamp_gt)) { return false; }
    if (query.timestamp_lt !== undefined && !(doc.timestamp <   query.timestamp_lt)) { return false; }

    if (query.author !== undefined && !(doc.author === query.author)) { return false; }

    if (query.contentLength    !== undefined && !(stringLengthInBytes(doc.content) === query.contentLength   )) { return false; }
    if (query.contentLength_gt !== undefined && !(stringLengthInBytes(doc.content) >   query.contentLength_gt)) { return false; }
    if (query.contentLength_lt !== undefined && !(stringLengthInBytes(doc.content) <   query.contentLength_lt)) { return false; }

    return true;
}

export let documentIsExpired = (doc: Document, now: number): boolean => {
    return (doc.deleteAfter !== null) && (doc.deleteAfter < now);
}

export let sortLatestFirst = (a: Document, b: Document): number => {
    // Used to pick the winning document within one path.
    // Puts the winning version first.
    // timestamp DESC (newest first), then signature ASC (to break timestamp ties)
    if (a.timestamp < b.timestamp) { return 1; }
    if (a.timestamp > b.timestamp) { return -1; }
    if (a.signature > b.signature) { return 1; }  // TODO: test signature sorting
    if (a.signature < b.signature) { return -1; }
    return 0;
};

export let sortPathAscAuthorAsc = (a: Document, b: Document): number => {
    // Used to sort overall query results.
    // path ASC, then author ASC within the same path.
    if (a.path > b.path) { return 1; }
    if (a.path < b.path) { return -1; }
    if (a.author > b.author) { return 1; }
    if (a.author < b.author) { return -1; }
    return 0;
};
