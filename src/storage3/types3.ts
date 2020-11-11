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
    onWrite : Emitter<WriteEvent3>;
    _now: number | null;  // used for testing time behavior.  is used instead of Date.now().  normally null.

    // TODO: session id?

    // simple key-value store for config settings
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
    close(): void;
    isClosed(): boolean;
    destroyAndClose(): void  // override
}
