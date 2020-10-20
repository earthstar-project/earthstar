import {
    AuthorAddress,
    Document
} from '../util/types';

/*
open questions

    when doing paths(query), is it...
    * doing a cheap query only on the paths column, using path and pathPrefix?
    * or doing a full query also using author, timestamp, etc, then getting unique paths?

    isHead: rename to includeAll?  we rarely want to exclude heads

*/

export interface SimpleQuery3 {
    // things that are the same for all documents with the same path
    path?: string,
    pathPrefix?: string,
    limit?: number,
}

export interface FancyQuery3 extends SimpleQuery3 {
    // TODO: workspace?

    timestamp?: number,
    timestamp_gt?: number,
    timestamp_lt?: number,

    author?: AuthorAddress,

    contentSize?: number,  // in bytes as utf-8.  skip sparse documents with null content
    contentSize_gt?: number,
    contentSize_lt?: number,

    isHead?: boolean,  // true to only get head, omit to get all.
                       // this is the actual overall latest doc per path,
                       // not just the latest doc per path that passes the rest of the query.

    limitBytes?: number,  // sum of content bytes <= limitBytes (stop as soon as possible)

    // sort?: 'newest' | 'oldest' | 'path',  // default is path
    // continueAfter: {path, timestamp, ...signature? author? hash?}
};

const defaultQuery2 = {
    // isHead: false,
    // sort: 'path',
}

export let cleanUpQuery = (query: FancyQuery3): FancyQuery3 => {
    // set defaults
    let q = {...defaultQuery2, ...query};

    // TODO: what to do with -1 on limit, contentSize?
    // TODO: what to do with isHead: false?

    //// limits can be zero but not negative
    //if (q.limit !== undefined) { q.limit = Math.max(q.limit, 0); }
    //if (q.limitBytes !== undefined) { q.limitBytes = Math.max(q.limitBytes, 0); }
    return q;
}

export let queryMatchesDoc = (query: FancyQuery3, doc: Document): boolean => {
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
