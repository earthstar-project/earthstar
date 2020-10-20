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
import { SimpleQuery3, FancyQuery3 } from './query3';
import { Emitter } from '../util/emitter';

//================================================================================

export interface IStorage3 {
    readonly workspace : WorkspaceAddress;
    onWrite : Emitter<WriteEvent>;
    _now: number | null;  // used for testing time behavior.  is used instead of Date.now().  normally null.

    // simple key-value store for config settings
    setConfig(key: string, content: string): void;  // override
    getConfig(key: string): string | undefined;  // override
    deleteConfig(key: string): void;  // override
    deleteAllConfig(): void;  // override

    // GET DATA OUT
    documents(query?: FancyQuery3): Document[];  // override
    paths(query?: FancyQuery3): string[];
    contents(query?: FancyQuery3): string[];
    authors(query?: FancyQuery3): AuthorAddress[];
    getDocument(path: string): Document | undefined;
    getContent(path: string): string | undefined;

    // PUT DATA IN
    _upsertDocument(doc: Document): void;  // override
    ingestDocument(doc: Document, isLocal: boolean): WriteResult | ValidationError;
    set(keypair: AuthorKeypair, docToSet: DocToSet): WriteResult | ValidationError;

    removeExpiredDocuments(now: number): void;  // override

    // CLOSE
    close(): void;
    isClosed(): boolean;
    removeAndClose(): void  // override
}
