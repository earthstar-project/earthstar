import { Doc, Path, WorkspaceAddress } from "../util/doc-types";
import { StorageIsClosedError } from '../util/errors';
import { StorageDriverAsyncMemory } from "./storage-driver-async-memory";

type SerializedDriverDocs = {
    byPathAndAuthor: Record<string, Doc>;
    byPathNewestFirst: Record<Path, Doc[]>;
};

function isSerializedDriverDocs(value: any): value is SerializedDriverDocs {
    // check if data we've loaded from localStorage is actually in the format we expect
    if (typeof value !== "object") {
        return false;
    }
    return ("byPathAndAuthor" in value && "byPathNewestFirst" in value);
}

export class StorageDriverLocalStorage extends StorageDriverAsyncMemory {
    _localStorageKeyConfig: string;
    _localStorageKeyDocs: string;

    constructor(workspace: WorkspaceAddress) {
        super(workspace);

        // each config item starts with this prefix and gets its own entry in localstorage
        this._localStorageKeyConfig = `stonesoup:config:${workspace}`;  // TODO: change this to "earthstar:..." later
        // all docs are stored inside this one item, as a giant JSON object
        this._localStorageKeyDocs = `stonesoup:documents:pathandauthor:${workspace}`;

        let existingData = localStorage.getItem(this._localStorageKeyDocs);

        if (existingData !== null) {
            let parsed = JSON.parse(existingData);

            if (!isSerializedDriverDocs(parsed)) {
                console.warn(`localStorage data could not be parsed for workspace ${workspace}`);
                return;
            }

            this.docByPathAndAuthor = new Map(Object.entries(parsed.byPathAndAuthor));
            this.docsByPathNewestFirst = new Map(Object.entries(parsed.byPathNewestFirst));
        }
    }

    //--------------------------------------------------
    // LIFECYCLE

    // close(): inherited
    // isClosed(): inherited
    async destroy(): Promise<void> {
        if (this._isClosed) { throw new StorageIsClosedError(); }
        await super.destroy();
        localStorage.removeItem(this._localStorageKeyDocs);
        for (let key of await this.listConfigKeys()) {
            await this.deleteConfig(key);
        }
    }

    //--------------------------------------------------
    // CONFIG

    async getConfig(key: string): Promise<string | undefined> {
        if (this._isClosed) { throw new StorageIsClosedError(); }
        key = `${this._localStorageKeyConfig}:${key}`;
        let result = localStorage.getItem(key);
        return result === null ? undefined : result;
    }
    
    async setConfig(key: string, value: string): Promise<void> {
        if (this._isClosed) { throw new StorageIsClosedError(); }
        await super.setConfig(key, value);

        key = `${this._localStorageKeyConfig}:${key}`;
        localStorage.setItem(key, value);
    }

    async listConfigKeys(): Promise<string[]> {
        if (this._isClosed) { throw new StorageIsClosedError(); }
        let keys = Object.keys(localStorage)
            .filter(key => key.startsWith(this._localStorageKeyConfig + ':'))
            .map(key => key.slice(this._localStorageKeyConfig.length + 1));
        keys.sort();
        return keys;
    }

    async deleteConfig(key: string): Promise<boolean> {
        if (this._isClosed) { throw new StorageIsClosedError(); }
        let hadIt = await super.deleteConfig(key);
        
        key = `${this._localStorageKeyConfig}:${key}`;
        localStorage.removeItem(key);
        
        return hadIt;
    }

    //--------------------------------------------------
    // GET

    // getMaxLocalIndex(): inherited
    // queryDocs(query: Query): inherited

    //--------------------------------------------------
    // SET

    async upsert(doc: Doc): Promise<Doc> {
        if (this._isClosed) { throw new StorageIsClosedError(); }
        let upsertedDoc = await super.upsert(doc);

        // After every upsert, for now, we save everything
        // to localStorage as a single giant JSON blob.
        // TODO: debounce this, only do it every 1 second or something

        const docsToBeSerialised: SerializedDriverDocs = {
            byPathAndAuthor: Object.fromEntries(this.docByPathAndAuthor),
            byPathNewestFirst: Object.fromEntries(this.docsByPathNewestFirst),
        };

        localStorage.setItem(
            this._localStorageKeyDocs,
            JSON.stringify(docsToBeSerialised)
        );

        return upsertedDoc;
    }
}
