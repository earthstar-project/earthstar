import {
    Doc,
} from '../util/doc-types';
import {
    DEFAULT_QUERY,
    Query,
    QueryFilter,
} from './query-types';

import {
    deepEqual,
} from '../util/misc';

//================================================================================ 

export type WillMatch = 'all' | 'all-latest' | 'some' | 'nothing';
export interface CleanUpQueryResult {
    query: Query,
    isValid: boolean,
    willMatch: WillMatch;
}
export let cleanUpQuery = (inputQuery: Query): CleanUpQueryResult => {
    // check for invalid queries and return null
    // canonicalize and optimize queries
    // check for filters that obviously result in nothing and return a canonical empty query: { limit: 0 }

    // apply default values
    let query = { ...DEFAULT_QUERY, ...inputQuery };

    //--------------------------------------------------
    // VALIDITY

    let invalidResponse: CleanUpQueryResult = {
        query: { limit: 0 },
        isValid: false,
        willMatch: 'nothing',
    }

    // TODO: check if contentLength and timestamp are reasonable numbers

    // limit should be a reasonable number
    if (query.limit !== undefined && query.limit < 0) { return invalidResponse; }

    // if orderBy is path, startAt should contain path or nothing, not localIndex
    // if orderBy is localIndex, startAt should contain localIndex or nothing, not path
    if (query.orderBy?.startsWith('path') && query.startAt?.localIndex !== undefined) { return invalidResponse; }
    if (query.orderBy?.startsWith('localIndex') && query.startAt?.path !== undefined) { return invalidResponse; }

    // valid enum values
    if (query.historyMode !== undefined && query.historyMode !== 'all' && query.historyMode !== 'latest') { return invalidResponse; }
    if (query.orderBy !== undefined) {
        if (['path ASC', 'path DESC', 'localIndex ASC', 'localIndex DESC'].indexOf(query.orderBy) === -1) {
            return invalidResponse;
        }
    }

    //--------------------------------------------------
    // WILLMATCH

    // start with everything, then narrow down
    let willMatch: WillMatch = query.historyMode === 'all' ? 'all' : 'all-latest';

    // if there are filters, match some
    if (query.filter !== undefined && !deepEqual(query.filter, {})) {
        willMatch = 'some';
    }

    // a startAt makes us match some
    if (query.startAt !== undefined && !deepEqual(query.startAt, {})) {
        willMatch = 'some';
    }

    // a limit makes us match some or nothing
    if (query.limit !== undefined) {
        if (query.limit > 0) { willMatch = 'some'; }
        if (query.limit === 0) { willMatch = 'nothing'; }
    }

    // filter combinations that result in no matches --> nothing
    if (query.filter !== undefined) {
        let filter = query.filter;
        if (filter.path && filter.pathStartsWith && !filter.path.startsWith(filter.pathStartsWith)) { willMatch = 'nothing'; }
        if (filter.path && filter.pathEndsWith && !filter.path.endsWith(filter.pathEndsWith)) { willMatch = 'nothing'; }
        if (filter.timestamp && filter.timestampGt && !(filter.timestamp > filter.timestampGt)) { willMatch = 'nothing'; }
        if (filter.timestamp && filter.timestampLt && !(filter.timestamp < filter.timestampLt)) { willMatch = 'nothing'; }
        if (filter.timestampGt && filter.timestampLt && !(filter.timestampLt+1 < filter.timestampGt)) { willMatch = 'nothing'; }
        if (filter.contentLength && filter.contentLengthGt && !(filter.contentLength > filter.contentLengthGt)) { willMatch = 'nothing'; }
        if (filter.contentLength && filter.contentLengthLt && !(filter.contentLength < filter.contentLengthLt)) { willMatch = 'nothing'; }
        if (filter.contentLengthGt && filter.contentLengthLt && !(filter.contentLengthLt+1 < filter.contentLengthGt)) { willMatch = 'nothing'; }
    }

    if (willMatch === 'nothing') {
        return {
            query: { limit: 0 },
            isValid: true,
            willMatch: 'nothing',
        };
    }

    return {
        query,
        isValid: true,
        willMatch,
    };
}

export let docMatchesFilter = (doc: Doc, filter: QueryFilter): boolean => {
    // Does the doc match the filters?
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
