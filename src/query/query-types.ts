import {
  AuthorAddress,
  FormatName,
  Path,
  Timestamp,
} from "../util/doc-types.ts";

//================================================================================

/** Filters a query by document attributes. */
export interface QueryFilter {
  path?: Path;
  pathStartsWith?: string;
  pathEndsWith?: string;
  author?: AuthorAddress;
  timestamp?: Timestamp;
  timestampGt?: Timestamp;
  timestampLt?: Timestamp;
}

export type HistoryMode = "latest" | "all";

/** Describes a query for fetching documents from a replica. */
export interface Query<FormatsType extends FormatName[]> {
  // for each property, the first option is the default if it's omitted

  // this is in the order that processing happens:

  // first, limit to latest docs or all doc.

  /** Whether to fetch all historical versions of a document or just the latest versions. */
  historyMode?: HistoryMode;

  // then iterate in this order
  //   "path ASC" is actually "path ASC then break ties with timestamp DESC"
  //   "path DESC" is the reverse of that

  /** The order to return docs in. Defaults to `path ASC`. */
  orderBy?: "path ASC" | "path DESC" | "localIndex ASC" | "localIndex DESC";

  // start iterating immediately after this item (e.g. get items which are > startAfter)

  /** Only fetch documents which come after a certain point. */
  startAfter?: {
    /** Only documents after this localIndex. Only works when ordering by localIndex. */
    localIndex?: number;

    /** Only documents after this path. Only works when ordering by path. */
    path?: string;
  };

  // then apply filters, if any
  filter?: QueryFilter;

  // stop iterating after this number of docs
  /** The maximum number of documents to return. */
  limit?: number;

  formats?: FormatsType;
}

export const DEFAULT_QUERY: Query<["es.5"]> = {
  historyMode: "latest",
  orderBy: "path ASC",
  startAfter: undefined,
  limit: undefined,
  filter: undefined,
  formats: ["es.5"],
};
