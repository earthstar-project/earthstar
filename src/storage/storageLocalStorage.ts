import debounce = require('lodash.debounce');
import { IValidator, WorkspaceAddress } from '../util/types';
import { WriteEvent3 } from './storageTypes';
import { Query3ForForget } from './query';
import { Storage3Memory } from './storageMemory';

//================================================================================

export class Storage3LocalStorage extends Storage3Memory {
    /**
     * Stores a workspace in browser localStorage.
     * 
     * This has many caveats and warnings!  Read carefully.
     * 
     * This code is untested.
     * TODO: add a node polyfill for localStorage so we can test this from the command line.
     * 
     * Browsers limit localStorage to 5mb total.
     * 
     * The data is loaded from localStorage on startup, then held in memory.
     * With every document change, the entire dataset is written back to localStorage
     * as a single giant JSON string under a single localStorage key, even if
     * only one document has changed.
     * This is not efficient!
     * But since LocalStorage can only hold up to 5mb, it's only slightly terrible.
     * It would be better to write each doc to its own localStorage key, but we
     * probably still need to hold them all in memory for efficient querying.
     * 
     * This won't work well if used from multiple browser tabs at the same time.
     * The tabs clobber each other's changes.
     * The solution is to elect one tab as a leader and send all operations to
     * that tab... or somehow monitor changes to localStorage and pick up changes
     * from other tabs...
     * or never hold the docs in memory and only keep state in localStorage.
     */
    _localStorageKeyConfig: string;
    _localStorageKeyDocs: string;
    _debouncedSaveQuick: () => void;
    _debouncedSaveSlow: () => void;
    constructor(validators: IValidator[], workspace: WorkspaceAddress) {
        super(validators, workspace);

        // load _docs from localStorage during initialization
        this._localStorageKeyConfig = `earthstar:config:${workspace}`;
        this._localStorageKeyDocs = `earthstar:documents:${workspace}`;
        let existingData = localStorage.getItem(this._localStorageKeyDocs);
        if (existingData !== null) {
            this._docs = JSON.parse(existingData);
        }

        // Saving the entire list of docs will get triggered on every changed document,
        // so we need to debounce it to avoid excessive writes.
        // Local writes will be written more quickly, and incoming sync'd documents
        // will have a slower debounce since they tend to arrive in large groups.
        // "Debounce" means every attempt to call the function restarts a cooldown timer
        // that runs for N milliseconds and then actually runs the function, once.
        // So a save will only occur after there's no write activity for N milliseconds.
        // TODO: should we use throttle instead?  The current system means a slow steady
        // trickle of docs can prevent saving from ever happening.
        let saveToLocalStorage = () => {
            localStorage.setItem(this._localStorageKeyDocs, JSON.stringify(this._docs));
        };
        this._debouncedSaveQuick = debounce(saveToLocalStorage, 50, { trailing: true });
        this._debouncedSaveSlow = debounce(saveToLocalStorage, 333, { trailing: true });

        this.onWrite.subscribe((e: WriteEvent3) => {
            if (e.isLocal) { this._debouncedSaveQuick(); }
            else { this._debouncedSaveSlow(); }
        });
    }

    // Each config key gets its own localStorage key.
    setConfig(key: string, content: string): void {
        key = `${this._localStorageKeyConfig}:${key}`;
        localStorage.setItem(key, content);
    }
    getConfig(key: string): string | undefined {
        key = `${this._localStorageKeyConfig}:${key}`;
        let result = localStorage.getItem(key);
        return result === null ? undefined : result;
    }
    deleteConfig(key: string): void {
        key = `${this._localStorageKeyConfig}:${key}`;
        localStorage.removeItem(key);
    }
    deleteAllConfig(): void {
        for (let key of Object.keys(localStorage)) {
            if (key.startsWith(this._localStorageKeyConfig + ':')) {
                localStorage.removeItem(key);
            }
        }
    }

    // anything that modifies this._docs needs to trigger a save.

    // set() and ingest() are already covered by the onWrite listener
    // we added in the constructor.

    forgetDocuments(q: Query3ForForget): void {
        super.forgetDocuments(q);
        this._debouncedSaveQuick();
    }

    discardExpiredDocuments(): void {
        super.discardExpiredDocuments();
        this._debouncedSaveQuick();
    }

    closeAndForgetWorkspace(): void {
        this._assertNotClosed();
        this.close();
        this._docs = {};
        this.deleteAllConfig();
        localStorage.removeItem(this._localStorageKeyDocs);
    }
}
