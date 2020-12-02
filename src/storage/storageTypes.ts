import {
    AuthorAddress,
    AuthorKeypair,
    DocToSet,
    Document,
    ValidationError,
    WorkspaceAddress,
    WriteResult,
} from '../util/types';
import { Query, QueryForForget, QueryNoLimitBytes } from './query';
import { Emitter } from '../util/emitter';

//================================================================================

/**
 * The event your callback gets when you subscribe to IStorage.onWrite.subscribe(callback).
 */
export type WriteEvent = {
    kind: 'DOCUMENT_WRITE',
    /** The new version of the document that was written. */
    document: Document,
    /** The sessionId of the peer who gave us this document. */
    fromSessionId: string,
    /** Was this write initiated by ourself (the local peer)? */
    isLocal: boolean,
    /** Is this doc the one with the highest timestamp in its path? */
    isLatest: boolean,
}

/**
 * An IStorage instance holds the documents of a single workspace
 * in some kind of local storage (memory, a database, etc).
 *
 * To construct an IStorage, you need to supply
 *   * a workspace address
 *   * a list of Validator classes for the document formats you want to support
 *   * various other options such as database filenames, specific to that kind of Storage
 *
 * Any document objects touched by the IStorage (both inputs and outputs)
 * are immutable and will be frozen with Object.freeze().
 * 
 * There is a base class (StorageBase) that should be subclassed
 * for each storage backend (memory, localStorage, etc).
 * Methods marked "override" are the core functionality
 * and must be implemented by the subclasses.
 * The other, secondary methods are already implemented by the base class,
 * using the core functions, but can be overridden if a storage backend has
 * a more efficient way of doing it.
 */
export interface IStorage {
    readonly workspace : WorkspaceAddress;
    readonly sessionId: string;  // gets a new random value every time the program runs
    _now: number | null;  // used for testing time behavior.  is used instead of Date.now().  normally null.

    // EVENTS
    onWrite: Emitter<WriteEvent>;  // fired synchronously just after each document write
    onWillClose: Emitter<undefined>;  // fired synchronously at the beginning of close()
    onDidClose: Emitter<undefined>;  // fired synchronously at the end of close()

    // KEY-VALUE STORE for config settings
    setConfig(key: string, content: string): void;  // override
    getConfig(key: string): string | undefined;  // override
    deleteConfig(key: string): void;  // override
    deleteAllConfig(): void;  // override

    // GET DATA OUT
    documents(query?: Query): Document[];  // override
    contents(query?: Query): string[];
    paths(query?: QueryNoLimitBytes): string[];
    authors(): AuthorAddress[];
    getDocument(path: string): Document | undefined;
    getContent(path: string): string | undefined;

    // PUT DATA IN
    _upsertDocument(doc: Document): void;  // override
    ingestDocument(doc: Document, fromSessionId: string): WriteResult | ValidationError;
    set(keypair: AuthorKeypair, docToSet: DocToSet): WriteResult | ValidationError;

    // REMOVE DATA
    forgetDocuments(query: QueryForForget): void;  // override
    discardExpiredDocuments(): void;  // override

    // CLOSE
    isClosed(): boolean;
    _close(opts: { delete: boolean }): void;  // override if needed to do specific closing stuff for your subclass
    close(opts?: { delete: boolean }): void;
}

export interface IStorageAsync {
    readonly workspace : WorkspaceAddress;
    readonly sessionId: string;  // gets a new random value every time the program runs
    _now: number | null;  // used for testing time behavior.  is used instead of Date.now().  normally null.

    // EVENTS
    onWrite: Emitter<WriteEvent>;  // fired synchronously just after each document write
    onWillClose: Emitter<undefined>;  // fired synchronously at the beginning of close()
    onDidClose: Emitter<undefined>;  // fired synchronously at the end of close()

    // KEY-VALUE STORE for config settings
    setConfig(key: string, content: string): Promise<void>;  // override
    getConfig(key: string): Promise<string | undefined>;  // override
    deleteConfig(key: string): Promise<void>;  // override
    deleteAllConfig(): Promise<void>;  // override

    // GET DATA OUT
    documents(query?: Query): Promise<Document[]>;  // override
    contents(query?: Query): Promise<string[]>;
    paths(query?: QueryNoLimitBytes): Promise<string[]>;
    authors(): Promise<AuthorAddress[]>;
    getDocument(path: string): Promise<Document | undefined>;
    getContent(path: string): Promise<string | undefined>;

    // PUT DATA IN
    _upsertDocument(doc: Document): Promise<void>;  // override
    ingestDocument(doc: Document, fromSessionId: string): Promise<WriteResult | ValidationError>;
    set(keypair: AuthorKeypair, docToSet: DocToSet): Promise<WriteResult | ValidationError>;

    // REMOVE DATA
    forgetDocuments(query: QueryForForget): Promise<void>;  // override
    discardExpiredDocuments(): Promise<void>;  // override

    // CLOSE
    isClosed(): boolean;
    _close(opts: { delete: boolean}): Promise<void>;  // override if needed to do specific closing stuff for your subclass
    close(opts?: { delete: boolean }): Promise<void>;
}
