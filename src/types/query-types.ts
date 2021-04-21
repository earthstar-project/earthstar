import {
    Path,
    AuthorAddress,
    Timestamp,
} from './doc-types';

//================================================================================

// ways to filter an individual document with no other context
export interface QueryFilter {
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

export type HistoryMode = 'latest' | 'all';
export interface Query {
    // for each property, the first option is the default if it's omitted

    // this is in the order that processing happens:

    // first, limit to latest docs or all docs
    historyMode?: HistoryMode;

    // then iterate in this order
    //   "path ASC" is actually "path ASC then break ties with timestamp DESC"
    //   "path DESC" is the reverse of that
    orderBy?: 'path ASC' | 'path DESC' | 'localIndex ASC' | 'localIndex DESC';

    // start iterating at this item
    startAt?: {
        // only when ordering by localIndex
        localIndex?: number,
        // only when ordering by path
        path?: string,
    }

    // then apply filters, if any
    filter?: QueryFilter,

    // stop iterating after this number of docs
    limit?: number;
    // TODO: limitBytes
}

export let DEFAULT_QUERY: Query = {
    historyMode: 'latest',
    orderBy: 'path ASC',
    startAt: undefined,
    limit: undefined,
    filter: undefined,
}
