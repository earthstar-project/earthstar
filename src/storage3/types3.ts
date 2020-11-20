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
import { Query3, Query3ForForget, Query3NoLimitBytes } from './query3';
import { Emitter } from '../util/emitter';

//================================================================================

/**
 * The event your callback gets when you subscribe to IStorage.onWrite.subscribe(callback).
 */
export type WriteEvent3 = {
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
 * An IStorage3 instance holds the documents of a single workspace
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
 * There is a base class (Storage3Base) that should be subclassed
 * for each storage backend (memory, localStorage, etc).
 * Methods marked "override" are the core functionality
 * and must be implemented by the subclasses.
 * The other, secondary methods are already implemented by the base class,
 * using the core functions, but can be overridden if a storage backend has
 * a more efficient way of doing it.
 */
export interface IStorage3 {
    readonly workspace : WorkspaceAddress;
    readonly sessionId: string;  // gets a new random value every time the program runs
    _now: number | null;  // used for testing time behavior.  is used instead of Date.now().  normally null.

    // EVENTS
    onWrite: Emitter<WriteEvent3>;  // fired synchronously just after each document write
    onWillClose: Emitter<undefined>;  // fired synchronously at the beginning of close()
    onDidClose: Emitter<undefined>;  // fired synchronously at the end of close()

    // KEY-VALUE STORE for config settings
    setConfig(key: string, content: string): void;  // override
    getConfig(key: string): string | undefined;  // override
    deleteConfig(key: string): void;  // override
    deleteAllConfig(): void;  // override

    // GET DATA OUT
    documents(query?: Query3): Document[];  // override
    contents(query?: Query3): string[];
    paths(query?: Query3NoLimitBytes): string[];
    authors(): AuthorAddress[];
    getDocument(path: string): Document | undefined;
    getContent(path: string): string | undefined;

    // PUT DATA IN
    _upsertDocument(doc: Document): void;  // override
    ingestDocument(doc: Document, fromSessionId: string): WriteResult | ValidationError;
    set(keypair: AuthorKeypair, docToSet: DocToSet): WriteResult | ValidationError;

    // REMOVE DATA
    forgetDocuments(query: Query3ForForget): void;  // override
    discardExpiredDocuments(): void;  // override

    // CLOSE
    isClosed(): boolean;
    close(): void;  // override if needed; remember to fire onWillClose and onDidClose
    closeAndForgetWorkspace(): void;  // override
}

export interface IStorage3Async {
    readonly workspace : WorkspaceAddress;
    readonly sessionId: string;  // gets a new random value every time the program runs
    _now: number | null;  // used for testing time behavior.  is used instead of Date.now().  normally null.

    // EVENTS
    onWrite: Emitter<WriteEvent3>;  // fired synchronously just after each document write
    onWillClose: Emitter<undefined>;  // fired synchronously at the beginning of close()
    onDidClose: Emitter<undefined>;  // fired synchronously at the end of close()

    // KEY-VALUE STORE for config settings
    setConfig(key: string, content: string): Promise<void>;  // override
    getConfig(key: string): Promise<string | undefined>;  // override
    deleteConfig(key: string): Promise<void>;  // override
    deleteAllConfig(): Promise<void>;  // override

    // GET DATA OUT
    documents(query?: Query3): Promise<Document[]>;  // override
    contents(query?: Query3): Promise<string[]>;
    paths(query?: Query3NoLimitBytes): Promise<string[]>;
    authors(): Promise<AuthorAddress[]>;
    getDocument(path: string): Promise<Document | undefined>;
    getContent(path: string): Promise<string | undefined>;

    // PUT DATA IN
    _upsertDocument(doc: Document): Promise<void>;  // override
    ingestDocument(doc: Document, fromSessionId: string): Promise<WriteResult | ValidationError>;
    set(keypair: AuthorKeypair, docToSet: DocToSet): Promise<WriteResult | ValidationError>;

    // REMOVE DATA
    forgetDocuments(query: Query3ForForget): Promise<void>;  // override
    discardExpiredDocuments(): Promise<void>;  // override

    // CLOSE
    isClosed(): boolean;
    close(): Promise<void>;  // override if needed; remember to fire onWillClose and onDidClose
    closeAndForgetWorkspace(): Promise<void>;  // override
}
