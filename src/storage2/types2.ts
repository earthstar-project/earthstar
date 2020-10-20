import {
    AuthorAddress,
    AuthorKeypair,
    DocToSet,
    Document,
    ValidationError,
    WorkspaceAddress,
    WriteEvent,
    WriteResult,
} from '../util/types';
import { Emitter } from '../util/emitter';
import { QueryOpts2 } from './query2';

//================================================================================

export interface IStorage2 {
    workspace : WorkspaceAddress;
    onWrite : Emitter<WriteEvent>;
    onChange : Emitter<undefined>;  // deprecated
    _now: number | null;  // used for testing time behavior.  is used instead of Date.now().  normally null.

    // constructor takes: a driver, a list of validators, and a workspace

    // GET DATA OUT
    // a path query should always be equal to
    //   unique(documents(query).map(doc => doc.path));
    // but it may be optimized behind the scenes.
    // exceptions:
    //   limit applies to returned items (paths or documents)
    //   limitBytes only applies to docs, not paths
    documents(query?: QueryOpts2): Document[];
    paths(query?: QueryOpts2): string[];
    contents(query?: QueryOpts2): string[];
    authors(): AuthorAddress[];
    // TODO: rename from "get" to "latest"
    getDocument(path: string): Document | undefined;
    getContent(path: string): string | undefined;
    // PUT DATA IN
    ingestDocument(doc: Document, isLocal: boolean): WriteResult | ValidationError;
    set(keypair: AuthorKeypair, docToSet: DocToSet): WriteResult | ValidationError;
    // CLOSE
    // removeExpiredDocs()?
    close(): void;
    isClosed(): boolean;
}

export interface IStorageDriver {
    // Driver for storage of one workspace.
    // Driver is responsible for:
    //   actually saving, loading, querying documents
    //   freezing documents
    //   cleanUpQuery
    //   filtering out expired documents when doing queries
    //   deleting all expired docs in at least 1 of these 3 circumstances:
    //      with a setInterval that it manages, running at least every 60 minutes
    //      on begin()
    //      on close()
    //   optionally, can also delete them when encountering them in a query.
    // Driver does NOT:
    //   no validation (documents, workspace addresses, ...
    //     ...timestamps & expiration of docs to be written,
    //     ...making sure workspace matches the rest of the driver
    //   no check if overwrites are by more recent documents.  just write it.

    // IStorage calls this before doing any other driver operations
    begin(workspace: WorkspaceAddress): void;

    // simple key-value store for config settings
    _setConfig(key: string, content: string): void;
    _getConfig(key: string): string | undefined;
    _deleteConfig(key: string): void;
    _deleteAllConfig(): void;

    documents(query: QueryOpts2, now: number): Document[];
    paths(query: QueryOpts2, now: number): string[];
    //contents?(query: QueryOpts2, now: number): string[];
    authors(now: number): AuthorAddress[];  // this includes "deleted" docs with content: '', but ignores expired docs
    _upsertDocument(doc: Document): void;  // overwrite existing doc no matter what
    removeExpiredDocuments(now: number): void;

    // IStorage calls then when the IStorage is closed.
    // IStorage will never call any driver methods again after calling close().
    close(): void;
}
