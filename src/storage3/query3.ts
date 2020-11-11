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
    // filters that affect all documents equally within the same path
    path?: string,
    pathPrefix?: string,

    // filters that differently affect documents within the same path
    timestamp?: number,
    timestamp_gt?: number,
    timestamp_lt?: number,

    author?: AuthorAddress,

    contentSize?: number,  // in bytes as utf-8.  skip sparse documents with null content
    contentSize_gt?: number,
    contentSize_lt?: number,

    // other settings

    //isHead?: boolean,  // true to only get head, omit to get all.
    //                   // this is the actual overall latest doc per path,
    //                   // not just the latest doc per path that passes the rest of the query.

    history?: HistoryMode,  // default: HEADS

    limit?: number,
    limitBytes?: number,  // sum of content bytes <= limitBytes (stop as soon as possible)

    // sort?: 'newest' | 'oldest' | 'path',  // default is path
    // continueAfter: {path, timestamp, ...signature? author? hash?}
};

export let validateQuery = (query: Query3): ValidationError | true => {
    if (query.limit !== undefined && query.limit < 0) { return new ValidationError('limit must be >= 0'); }
    if (query.limitBytes !== undefined && query.limitBytes < 0) { return new ValidationError('limitBytes must be >= 0'); }
    if (query.contentSize !== undefined && query.contentSize < 0) { return new ValidationError('contentSize must be >= 0'); }
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
        query = { limit: 0 };
    }

    // set defaults
    let q: Query3 = {
        history: 'latest',
        // sort: 'path',

        ...query
    };
    return q;
}

export let queryMatchesDoc = (query: Query3, doc: Document): boolean => {
    // only checks individual document properties,
    // not limit, historyMode, sort, etc

    if (query.path !== undefined && !(query.path === doc.path)) { return false; }
    if (query.pathPrefix !== undefined && !(doc.path.startsWith(query.pathPrefix))) { return false; }

    if (query.timestamp !== undefined && !(doc.timestamp === query.timestamp)) { return false; }
    if (query.timestamp_gt !== undefined && !(doc.timestamp > query.timestamp_gt)) { return false; }
    if (query.timestamp_lt !== undefined && !(doc.timestamp < query.timestamp_lt)) { return false; }

    if (query.author !== undefined && !(doc.author === query.author)) { return false; }

    if (query.contentSize !== undefined && !(doc.content.length === query.contentSize)) { return false; }
    if (query.contentSize_gt !== undefined && !(doc.content.length > query.contentSize_gt)) { return false; }
    if (query.contentSize_lt !== undefined && !(doc.content.length < query.contentSize_lt)) { return false; }

    return true;
}

export let historySortFn = (a: Document, b: Document): number => {
    // When used within one path's documents, puts the winning version first.
    // path ASC (abcd), then timestamp DESC (newest first), then signature DESC (to break timestamp ties)
    if (a.path > b.path) { return 1; }
    if (a.path < b.path) { return -1; }
    if (a.timestamp < b.timestamp) { return 1; }
    if (a.timestamp > b.timestamp) { return -1; }
    if (a.signature < b.signature) { return 1; }
    if (a.signature > b.signature) { return -1; }
    return 0;
};
