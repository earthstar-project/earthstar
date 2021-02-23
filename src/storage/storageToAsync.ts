import {
    AuthorAddress,
    AuthorKeypair,
    DocToSet,
    Document,
    ValidationError,
    WorkspaceAddress,
    WriteResult,
} from '../util/types';
import { sleep } from '../util/helpers';
import {
    Query,
    QueryForForget,
    QueryNoLimitBytes,
} from './query';
import {
    IStorage,
    IStorageAsync,
    WriteEvent,
} from './storageTypes';
import { Emitter } from '../util/emitter';

/**
 * Disguises a synchronous IStorage instance as an IStorageAsync.
 * Makes all the methods of the original storage return promises,
 * except for `isClosed()` which remains synchronous.
 * 
 * `fakeSleepTime` is an optional delay in ms that's added into each call,
 * for testing purposes.
 */
 
export class StorageToAsync implements IStorageAsync {
    readonly workspace : WorkspaceAddress;
    readonly sessionId: string;  // gets a new random value every time the program runs

    onWrite: Emitter<WriteEvent>;  // fired synchronously just after each document write
    onWillClose: Emitter<undefined>;  // fired synchronously at the beginning of close()
    onDidClose: Emitter<undefined>;  // fired synchronously at the end of close()

    _storage: IStorage;
    _fakeSleepTime: number;

    constructor(storage: IStorage, fakeSleepTime: number = 0) {
        this._storage = storage;
        this._fakeSleepTime = fakeSleepTime;

        this.workspace = this._storage.workspace;
        this.sessionId = this._storage.sessionId;

        this.onWrite = this._storage.onWrite;
        this.onWillClose = this._storage.onWillClose;
        this.onDidClose = this._storage.onDidClose;
    }

    // getter/setter to make _now transparently access the underlying storage
    get _now(): number | null {
        return this._storage._now;
    }
    set _now(val: number | null) {
        this._storage._now = val;
    }

    async _sleep() {
        if (this._fakeSleepTime) {
            await sleep(this._fakeSleepTime);
        }
    }

    // KEY-VALUE STORE for config settings
    async setConfig(key: string, content: string): Promise<void> {
        await this._sleep();
        return this._storage.setConfig(key, content);
    }
    async getConfig(key: string): Promise<string | undefined> {
        await this._sleep();
        return this._storage.getConfig(key);
    }
    async deleteConfig(key: string): Promise<void> {
        await this._sleep();
        return this._storage.deleteConfig(key);
    }
    async deleteAllConfig(): Promise<void> {
        await this._sleep();
        return this._storage.deleteAllConfig();
    }

    // GET DATA OUT
    async documents(query?: Query): Promise<Document[]> {
        await this._sleep();
        return this._storage.documents(query);
    }
    async contents(query?: Query): Promise<string[]> {
        await this._sleep();
        return this._storage.contents(query);
    }
    async paths(query?: QueryNoLimitBytes): Promise<string[]> {
        await this._sleep();
        return this._storage.paths(query);
    }
    async authors(): Promise<AuthorAddress[]> {
        await this._sleep();
        return this._storage.authors();
    }
    async getDocument(path: string): Promise<Document | undefined> {
        await this._sleep();
        return this._storage.getDocument(path);
    }
    async getContent(path: string): Promise<string | undefined> {
        await this._sleep();
        return this._storage.getContent(path);
    }

    // PUT DATA IN
    async _upsertDocument(doc: Document): Promise<void> {
        await this._sleep();
        return this._storage._upsertDocument(doc);
    }
    async ingestDocument(doc: Document, fromSessionId: string): Promise<WriteResult | ValidationError> {
        await this._sleep();
        return this._storage.ingestDocument(doc, fromSessionId);
    }
    async set(keypair: AuthorKeypair, docToSet: DocToSet): Promise<WriteResult | ValidationError> {
        await this._sleep();
        return this._storage.set(keypair, docToSet);
    }

    // REMOVE DATA
    async forgetDocuments(query: QueryForForget): Promise<void> {
        await this._sleep();
        return this._storage.forgetDocuments(query);
    }
    async discardExpiredDocuments(): Promise<void> {
        await this._sleep();
        return this._storage.discardExpiredDocuments();
    }

    // CLOSE
    isClosed(): boolean {
        return this._storage.isClosed();
    }
    async _close(opts: { delete: boolean }): Promise<void> {
        await this._sleep();
        return this._storage._close(opts);
    }
    async close(opts?: { delete: boolean }): Promise<void> {
        await this._sleep();
        return this._storage.close(opts);
    }
}


