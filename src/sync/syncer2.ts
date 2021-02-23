import fetch from 'isomorphic-fetch';
import {
    ConnectionRefusedError,
    Document,
    NetworkError,
    NotFoundError,
    Thunk,
    WorkspaceAddress,
    WriteResult,
    isErr,
} from '../util/types';
import {
    Emitter
} from '../util/emitter';
import { IStorage } from '../storage/storageTypes';
import { sleep } from '../util/helpers';
import Logger from '../util/log';

//================================================================================
// HELPERS

const syncLogger = new Logger('syncer2')

let logSyncer = (...args : any[])     => syncLogger.debug('💚 syncer | ', ...args);
let logSync = (...args : any[])       => syncLogger.debug('  🌲  one pub: SYNC | ', ...args);
let logPullStream = (...args : any[]) => syncLogger.debug('  🌲  one pub:     PULL STREAM | ', ...args);
let logPushStream = (...args : any[]) => syncLogger.debug('  🌲  one pub:     PUSH STREAM | ', ...args);
let logBulkPush = (...args : any[])   => syncLogger.debug('  🌲  one pub:     BULK PUSH | ', ...args);
let logBulkPull = (...args : any[])   => syncLogger.debug('  🌲  one pub:     BULK PULL | ', ...args);

let ensureTrailingSlash = (url : string) : string =>
    // input is a URL with no path, like https://mypub.com or https://mypub.com/
    url.endsWith('/') ? url : url + '/';

let urlGetDocuments = (domain : string, workspace : WorkspaceAddress) =>
    // domain should already end in a slash.
    // output is like https://mypub.com/earthstar-api/v1/+gardening.xxxxxxxx/documents
    `${domain}earthstar-api/v1/${workspace}/documents`;
let urlPostDocuments = urlGetDocuments;
let urlStream = (domain : string, workspace : WorkspaceAddress) =>
    `${domain}earthstar-api/v1/${workspace}/stream`;

//================================================================================

export interface PushOrPullStats {
    numIngested: number,
    numIgnored: number,
    numTotal: number,
    error: null | ConnectionRefusedError | NotFoundError | NetworkError,
}
let initialStats: PushOrPullStats = {
    numIngested: 0,
    numIgnored: 0,
    numTotal: 0,
    error: null,
}

export interface SyncerState {
    isPushStreaming: boolean,
    isPullStreaming: boolean,
    isBulkPulling: boolean,
    isBulkPushing: boolean,
    isBulkSyncing: boolean,
    closed: boolean,
    lastCompletedBulkPush: number,
    lastCompletedBulkPull: number,
}
let initialSyncerState: SyncerState = {
    isPushStreaming: false,
    isPullStreaming: false,
    isBulkPulling: false,  // pullOnce()
    isBulkPushing: false,  // pushOnce()
    isBulkSyncing: false,  // the overall progress of syncOnce(), which is a wrapper around pullOnce() and pushOnce().
    closed: false,
    lastCompletedBulkPush: 0,  // timestamps in microseconds
    lastCompletedBulkPull: 0,
}

export class OnePubOneWorkspaceSyncer {
    // Handles sync between a local IStorage and a remote pub over HTTP.
    // Can do streaming (push and pull) and bulk sync (push, pull, and bidirectional).
    // Be sure to call close() when you're done with it, to stop the streams and subscriptions.
    //
    // Streams won't run at the same time as bulk syncing, but this is handled internally
    // for you and you don't need to worry about it.  They'll resume when the bulk sync is over.

    storage: IStorage;
    domain: string;
    pullStream: null | EventSource;
    unsubFromStorage: null | Thunk;
    state: SyncerState;
    onStateChange: Emitter<SyncerState>;
    constructor(storage: IStorage, domain: string) {
        this.storage = storage;
        this.domain = ensureTrailingSlash(domain);
        this.pullStream = null;
        this.unsubFromStorage = null;
        this.state = { ...initialSyncerState };
        this.onStateChange = new Emitter<SyncerState>();
    }
    _bump() {
        this.onStateChange.send(this.state);
    }

    close() {
        if (!this.state.closed) {
            logSyncer('close');
            this.stopPushStream();
            this.stopPullStream();
            this.state.closed = true;
            this._bump();
        } else {
            logSyncer('close (was already closed)');
        }
    }

    startPushStream() {
        if (this.state.closed) { return; }

        let url = urlPostDocuments(this.domain, this.storage.workspace);
        logPushStream('starting push stream to ' + url);
        if (this.state.isPushStreaming) {
            logPushStream('(already running)');
            return;
        }

        this.unsubFromStorage = this.storage.onWrite.subscribe(async (e) => {
            // TODO: if (this.state.closed) { return; }
            if (e.kind === 'DOCUMENT_WRITE') {
                // If we receive a doc from one pub, we want to sync it up to
                // all the other pubs.  So instead of checking for isLocal,
                // let's handle every event.
                // This will cause a cascade of echoed docs through the entire network
                // but it won't cascade forever, because eventually the writes will
                // stop when each peer has the document:
                //
                //     Pub1        Me         Pub2
                //     ====        ====       ====
                //     new -->
                //             <-- new -->
                //     ignored            <-- new
                //                 ignored
                //
                logPushStream('pushing a doc...');
                let stats = await this._pushDocs(url, [e.document]);
                if (stats.error) {
                    logPushStream(stats.error.name + ': ' + stats.error.message);
                } else {
                    logPushStream(stats);
                }
            }
        });

        this.state.isPushStreaming = true;
        this._bump();
    }
    stopPushStream() {
        if (this.state.closed) { return; }

        logPushStream('stopping push stream');
        if (this.unsubFromStorage) {
            this.unsubFromStorage();
        } else {
            logPushStream('(already stopped)');
        }

        this.state.isPushStreaming = false;
        this._bump();
    }
    startPullStream() {
        if (this.state.closed) { return; }

        let url = urlStream(this.domain, this.storage.workspace);
        logPullStream('starting pull stream from ' + url);
        if (this.pullStream) {                
            logPullStream('(already running)');
            return;
        }

        this.pullStream = new EventSource(url);
        this.pullStream.onerror = (e) => {
            logPullStream('connection failed');
            syncLogger.error(e);
        }
        this.pullStream.onmessage = (e) => {
            // TODO: if (this.state.closed) { return; }
            logPullStream('    message', e.data);
            if (e.data === 'KEEPALIVE') { return; }
            try {
                let doc: Document = JSON.parse(e.data);
                let result = this.storage.ingestDocument(doc, "TODO: session id")
                if (isErr(result)) {
                    logPullStream('    write failed: ', result.name, result.message);
                } else {
                    logPullStream('    write: ' + result);
                }
            } catch (e) {
                logPullStream('error, probably bad json');
                syncLogger.error(e);
            }
        };
        this.state.isPullStreaming = true;
        this._bump();
    }
    stopPullStream() {
        if (this.state.closed) { return; }

        logPullStream('stopping pull stream');
        if (this.pullStream) {
            this.pullStream.close();
            this.pullStream = null;
        } else {
            logPullStream('(already stopped)');
        }

        this.state.isPullStreaming = false;
        this._bump();
    }
    async _pushDocs(url: string, docs: Document[]): Promise<PushOrPullStats> {
        // Upload some docs to a pub
        // This is used by pushOnce() and push streaming
        let stats = { ...initialStats };
        let resp : any;
        try {
            resp = await fetch(url, {
                method: 'post',
                body:    JSON.stringify(this.storage.documents({ history: 'all' })),
                headers: { 'Content-Type': 'application/json' },
            });
        } catch (e) {
            stats.error = new NetworkError('could not connect to ' + url);
            return stats;
        }
        if (resp.status === 404) {
            stats.error = new ConnectionRefusedError('pub is closed (not accepting new workspaces)');
            return stats;
        } 
        if (resp.status === 403) {
            stats.error = new ConnectionRefusedError('pub is read-only (not accepting new data from anyone)');
            return stats;
        }
        return { ...stats, ...await resp.json() };
    }
    async pushOnce(_continueLive: boolean = false): Promise<PushOrPullStats> {
        // Do a single bulk push of all the local documents.

        let stats = { ...initialStats };
        if (this.state.closed) { return stats; }

        let workspace = this.storage.workspace;
        let url = urlPostDocuments(this.domain, workspace);

        logBulkPush('pushing to ' + url);
        if (this.state.isBulkPushing) {
            logSync('(push already in progress)');
            return stats;
        }

        let wasPullStreaming = this.state.isPullStreaming;
        if (wasPullStreaming) {
            logSync('pausing pull stream while bulk push is happening');
            this.stopPullStream();
        }

        this.state.isBulkPushing = true;
        this._bump();

        await sleep(150);

        stats = await this._pushDocs(url, this.storage.documents({ history: 'all' }));

        this.state.isBulkPushing = false;
        this.state.lastCompletedBulkPush = Date.now() * 1000;
        this._bump();
        if (stats.error) {
            logBulkPush(stats.error.name + ': ' + stats.error.message);
        } else {
            logBulkPush(stats);
        }

        if (wasPullStreaming || _continueLive) {
            // TODO: if user calls stopPullStream() while the stream is already stopped
            // because a bulk push is happening, the call to stopPullStream() will have
            // no effect and the stream will resume here anyway.
            // To fix, isPullStreaming needs a 3rd state 'paused'.
            // Same for vice-versa with push and pull.
            logSync('resuming pull stream');
            this.startPullStream();
        }

        return stats;
    }
    async pullOnce(_continueLive: boolean = false): Promise<PushOrPullStats> {
        // Do a single bulk pull all the pub's documents.
        // Note that pubs only create workspaces when pushed to, not pulled.
        // If the pub doesn't have the workspace, stats.error will be NotFoundError.

        let stats = { ...initialStats };
        if (this.state.closed) { return stats; }
        let workspace = this.storage.workspace;
        let url = urlGetDocuments(this.domain, workspace);
        logBulkPull('pulling from ' + url);
        if (this.state.isBulkPulling) {
            logSync('(pull already in progress)');
            return stats;
        }

        let wasPushStreaming = this.state.isPushStreaming;
        if (wasPushStreaming) {
            logSync('pausing push stream while bulk pull is happening');
            this.stopPushStream();
        }

        this.state.isBulkPulling = true;
        this._bump();

        await sleep(150);

        let resp : any;
        try {
            resp = await fetch(url);
        } catch (e) {
            stats.error = new NetworkError('could not connect to ' + url);
            logBulkPull(stats.error.name + ': ' + stats.error.message);
            this.state.isBulkPulling = false;
            this._bump();
            return stats;
        }

        if (resp.status === 404) {
            stats.error = new NotFoundError(`pub ${this.domain} does not know about workspace ${workspace}`);
            logBulkPull(stats.error.name + ': ' + stats.error.message);
            this.state.isBulkPulling = false;
            this._bump();
            return stats;
        }

        let docs = await resp.json();
        stats.numTotal = docs.length;
        for (let doc of docs) {
            if (this.storage.ingestDocument(doc, "TODO: session id") === WriteResult.Accepted) { stats.numIngested += 1; }
            else { stats.numIgnored += 1; }
        }
        logBulkPull(JSON.stringify(stats, null, 2));
        this.state.isBulkPulling = false;
        this.state.lastCompletedBulkPull = Date.now() * 1000;
        this._bump();

        if (wasPushStreaming || _continueLive) {
            logSync('resuming push stream stream');
            this.startPushStream();
        }

        return stats;
    }
    async syncOnceAndContinueLive() {
        return await this.syncOnce(true);
    }
    async syncOnce(_continueLive: boolean = false) {
        // Do a bulk push and a bulk pull.
        // if _continueLive, ensure that live streaming is on when the bulk sync is done.

        if (this.state.closed) { return; }
        logSync('starting sync: ' + this.domain);
        if (this.state.isBulkSyncing) {
            logSync('(sync already in progress)');
            return;
        }

        this.state.isBulkSyncing = true;
        this._bump();

        // TODO: we could actually do this in parallel
        let pushStats = await this.pushOnce(_continueLive);
        let pullStats = await this.pullOnce(_continueLive);

        logSync('done syncing: ' + this.domain);
        this.state.isBulkSyncing = false;
        this._bump();

        return {
            push: pushStats,
            pull: pullStats,
        }
    }
}
