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
*/

export type HistoryMode =
    'latest'  // get the overall latest per path (the heads), then apply filters just to those
  | 'all';    // return every individually matching history doc

/**
 * Query objects describe how to query a Storage instance for documents.
 * 
 * An empty query object returns all latest documents.
 * Each of the following properties adds an additional filter,
 * narrowing down the results further.
 * The exception is that history = 'latest' by default;
 * set it to 'all' to include old history documents also.
 * 
 * HISTORY MODES
 * - `latest`: get latest docs, THEN filter those.
 * - `all`: get all docs, THEN filter those.
 */
export interface Query {
    //=== filters that affect all documents equally within the same path

    /** Path exactly equals... */
    path?: string,

    /** Path begins with... */
    pathPrefix?: string,

    /** Path ends with this string.
     * Note that pathPrefix and pathSuffix can overlap: for example
     * { pathPrefix: "/abc", pathSuffix: "bcd" } will match "/abcd"
     * as well as "/abc/xxxxxxx/bcd".
     */
    pathSuffix?: string,

    //=== filters that differently affect documents within the same path

    /** Timestamp exactly equals... */
    timestamp?: number,

    /** Timestamp is greater than... */
    timestamp_gt?: number,

    /** Timestamp is less than than... */
    timestamp_lt?: number,

    /**
     * Document author.
     * 
     * With history:'latest' this only returns documents for which
     * this author is the latest author.
     * 
     * With history:'all' this returns all documents by this author,
     * even if those documents are not the latest ones anymore.
     */
    author?: AuthorAddress,

    contentLength?: number,  // in bytes as utf-8.  TODO: how to treat sparse docs with null content?
    contentLength_gt?: number,
    contentLength_lt?: number,

    //=== other settings

    /**
     * If history === 'latest', return the most recent doc at each path,
     * then apply other filters to that set.
     * 
     * If history === 'all', return every doc at each path (with each
     * other author's latest version), then apply other filters
     * to that set.
     * 
     * Default: latest
     */
    history?: HistoryMode,

    /**
     * Only return the first N documents.
     * There's no offset; use continueAfter instead.
     */
    limit?: number,

    /**
     * Accumulate documents until the sum of their content length <= limitByts.
     * 
     * Content length is measured in UTF-8 bytes, not unicode characters.
     * 
     * If some docs have length zero, stop as soon as possible (don't include them).
     */
    limitBytes?: number,

    /**
     * Begin with the next matching document after this one:
     */
    continueAfter?: {
        path: string,
        author: string,
    },
};

// A query where history is required to be "all"
interface QueryHistoryAll extends Query {
    history: 'all',
}

// A query without limit or limitBytes
export type QueryForForget = Omit<QueryHistoryAll, 'limit' | 'limitBytes'>;

// A query without limitBytes
export type QueryNoLimitBytes = Omit<Query, 'limitBytes'>;

/**
 * Check if a query object matches the expected schema for query objects.
 * 
 * Return true on success; return (not throw) a ValidationError on failure.
 */
export let validateQuery = (query: Query): ValidationError | true => {
    if (query.limit !== undefined && query.limit < 0) { return new ValidationError('limit must be >= 0'); }
    if (query.limitBytes !== undefined && query.limitBytes < 0) { return new ValidationError('limitBytes must be >= 0'); }
    if (query.contentLength !== undefined && query.contentLength < 0) { return new ValidationError('contentLength must be >= 0'); }
    if (query.history !== undefined && query.history !== 'all' && query.history !== 'latest') {
        return new ValidationError('unknown history mode: ' + query.history);
    }
    // TODO: check for extra properties?
    // TODO: check for data types
    return true;
}

/**
 * Validate and canonicalize a query; set its defaults; etc.
 * If the input query is invalid, return a new query that will never match anything,
 * since paths have to start with a '/':
 * 
 * ` { path: 'invalid-query', limit: 0 } `
 */
export let cleanUpQuery = (query: Query): Query => {
    let isValid = validateQuery(query);
    if (isErr(isValid)) {
        // if query is invalid, instead return a special query that will never match anything
        console.warn(isValid);
        return { path: 'invalid-query', limit: 0 };
    }
    // set defaults
    let q: Query = {
        history: 'latest',
        ...query
    };
    return q;
}

export let stringLengthInBytes = (s: string): number =>
    Buffer.byteLength(s, 'utf-8');

/**
 * Check if a document matches a query.
 * 
 * Only checks individual documents one at a time, so
 * it ignores historyMode, limit, limitBytes.
 * 
 * It does check continueAfter.
 */
export let queryMatchesDoc = (query: Query, doc: Document): boolean => {

    if (query.path       !== undefined && !(query.path === doc.path)) { return false; }
    if (query.pathPrefix !== undefined && !(doc.path.startsWith(query.pathPrefix))) { return false; }
    if (query.pathSuffix !== undefined && !(doc.path.endsWith(query.pathSuffix))) { return false; }

    if (query.timestamp    !== undefined && !(doc.timestamp === query.timestamp   )) { return false; }
    if (query.timestamp_gt !== undefined && !(doc.timestamp >   query.timestamp_gt)) { return false; }
    if (query.timestamp_lt !== undefined && !(doc.timestamp <   query.timestamp_lt)) { return false; }

    if (query.author !== undefined && !(doc.author === query.author)) { return false; }

    if (query.contentLength    !== undefined && !(stringLengthInBytes(doc.content) === query.contentLength   )) { return false; }
    if (query.contentLength_gt !== undefined && !(stringLengthInBytes(doc.content) >   query.contentLength_gt)) { return false; }
    if (query.contentLength_lt !== undefined && !(stringLengthInBytes(doc.content) <   query.contentLength_lt)) { return false; }

    if (query.continueAfter !== undefined) {
        let { path, author } = query.continueAfter;
        if (doc.path < path) { return false; }
        if (doc.path === path && doc.author <= author) { return false; }
    }

    return true;
}

/** Is a document expired?  (Ephemeral, and past its deletion date) */
export let documentIsExpired = (doc: Document, now: number): boolean => {
    return (doc.deleteAfter !== null) && (doc.deleteAfter < now);
}

export let sortLatestFirst = (a: Document, b: Document): number => {
    // Used to pick the winning document within one path.
    // Puts the winning version first.
    // timestamp DESC (newest first), then signature ASC (to break timestamp ties)
    if (a.timestamp < b.timestamp) { return 1; }  // highest timestamp wins...
    if (a.timestamp > b.timestamp) { return -1; }
    if (a.signature > b.signature) { return 1; }  // if tie, lowest signature wins
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
