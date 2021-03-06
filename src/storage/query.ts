import {
    AuthorAddress,
    Document,
    isErr,
    ValidationError
} from '../util/types';
import {
    objWithoutUndefined
} from '../util/helpers';

//================================================================================
// When doing cleanUpQuery, if the provided query is invalid,
// return this special query which will never match any documents:

export let QUERY_THAT_NEVER_MATCHES: Query = {
    path: 'invalid-query',  // paths normally have to start with '/'
    limit: 0,
}

//================================================================================

/*
open questions
    when doing paths(query), is it...
    * doing a cheap query only on the paths column, using path and pathStartsWith?
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
 * 
 * A property set to undefined is equivalent to not setting
 * that property at all, because cleanUpQuery(q) removes those
 * properties.
 */
export interface Query {
    //=== filters that affect all documents equally within the same path

    /** Path exactly equals... */
    path?: string,

    /** Path begins with... */
    pathStartsWith?: string,

    /** Path ends with this string.
     * Note that pathStartsWith and pathEndsWith can overlap: for example
     * { pathStartsWith: "/abc", pathEndsWith: "bcd" } will match "/abcd"
     * as well as "/abc/xxxxxxx/bcd".
     */
    pathEndsWith?: string,

    //=== filters that differently affect documents within the same path

    /** Timestamp exactly equals... */
    timestamp?: number,

    /** Timestamp is greater than... */
    timestampGt?: number,

    /** Timestamp is less than than... */
    timestampLt?: number,

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
    contentLengthGt?: number,
    contentLengthLt?: number,

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
    // note that contentLengthGt is allowed to be negative e.g. -1, so that you can make it match all content lengths if you're
    //  overriding another query...
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
        return { ...QUERY_THAT_NEVER_MATCHES };
    }
    // set defaults
    let q: Query = {
        // this is the only default we have so far
        history: 'latest',
        
        // remove undefined properties from the original query --
        // both as a general clean-up, and to prevent them
        // from shadowing our defaults (above).
        ...objWithoutUndefined(query),
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
    if (query.pathStartsWith !== undefined && !(doc.path.startsWith(query.pathStartsWith))) { return false; }
    if (query.pathEndsWith !== undefined && !(doc.path.endsWith(query.pathEndsWith))) { return false; }

    if (query.timestamp    !== undefined && !(doc.timestamp === query.timestamp   )) { return false; }
    if (query.timestampGt !== undefined && !(doc.timestamp >   query.timestampGt)) { return false; }
    if (query.timestampLt !== undefined && !(doc.timestamp <   query.timestampLt)) { return false; }

    if (query.author !== undefined && !(doc.author === query.author)) { return false; }

    if (query.contentLength    !== undefined && !(stringLengthInBytes(doc.content) === query.contentLength   )) { return false; }
    if (query.contentLengthGt !== undefined && !(stringLengthInBytes(doc.content) >   query.contentLengthGt)) { return false; }
    if (query.contentLengthLt !== undefined && !(stringLengthInBytes(doc.content) <   query.contentLengthLt)) { return false; }

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
