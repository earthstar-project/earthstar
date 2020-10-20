import {
    IStorageAsync,
    IStorage,
    WorkspaceAddress,
    WriteEvent,
    QueryOpts,
    Document,
    AuthorAddress,
    AuthorKeypair,
    DocToSet,
    WriteResult,
    ValidationError,
    SyncOpts,
    SyncResults,
} from '../util/types';
import { Emitter } from '../util/emitter';

export class StorageSyncToAsync implements IStorageAsync {
    storage: IStorage;
    workspace: WorkspaceAddress
    onWrite: Emitter<WriteEvent>;
    onChange: Emitter<undefined>;
    constructor(storage: IStorage) {
        this.storage = storage;
        this.workspace = storage.workspace;
        this.onWrite = storage.onWrite;
        this.onChange = storage.onChange;
    }
    async documents(query?: QueryOpts): Promise<Document[]> {
        return this.storage.documents(query);
    }
    async paths(query?: QueryOpts): Promise<string[]> {
        return this.storage.paths(query);
    }
    async contents(query?: QueryOpts): Promise<string[]> {
        return this.storage.contents(query);
    }
    async authors(now?: number): Promise<AuthorAddress[]> {
        return this.storage.authors(now);
    }

    async getDocument(path: string, now?: number): Promise<Document | undefined> {
        return this.storage.getDocument(path, now);
    }
    async getContent(path: string, now?: number): Promise<string | undefined> {
        return this.storage.getContent(path, now);
    }

    async set(keypair: AuthorKeypair, docToSet: DocToSet, now?: number): Promise<WriteResult | ValidationError> {
        return this.storage.set(keypair, docToSet, now);
    }
    async ingestDocument(doc: Document, now?: number, isLocal?: boolean): Promise<WriteResult | ValidationError> {
        return this.storage.ingestDocument(doc, now, isLocal);
    }

    //async _syncFrom(otherStore: IStorageAsync, existing: boolean, live: boolean): Promise<number> {
    //    return this.storage._syncFrom(otherStore, existing, live);
    //}
    //async sync(otherStore: IStorageAsync, opts?: SyncOpts): Promise<SyncResults> {
    //    return this.storage.sync(otherStore, opts);
    //}

    async close(): Promise<void> {
        this.storage.close();
    }
    isClosed() {
        return this.storage.isClosed();
    }
}
