import fetch from 'isomorphic-fetch';
import {
    WorkspaceAddress,
    WriteResult,
} from '../util/types';
import {
    Emitter
} from '../util/emitter';
import { IStorage, IStorageAsync } from '../storage/storageTypes';
import { sleep } from '../util/helpers';
import Logger from '../util/log'

const syncer1Logger = new Logger('syncer1 💚')
const syncerHttpLogger = new Logger('sync http alg 🌲')

// sync states
//  idle      sync has not been attempted since page load
//  syncing   syncing is happening now
//  success   syncing succeeded
//  failure   syncing failed (probably couldn't connect to pub)
export interface Pub {
    domain : string;
    syncState : 'idle' | 'syncing' | 'success' | 'failure';
    lastSync : number;
}
export interface SyncState {
    pubs : Pub[];
    // overall success is at least one pub success and any number of failures.
    // TODO: add a 'mixed' state
    syncState : 'idle' | 'syncing' | 'success' | 'failure';
    lastSync : number;
}

let ensureTrailingSlash = (url : string) : string =>
    // input is a URL with no path, like https://mypub.com or https://mypub.com/
    url.endsWith('/') ? url : url + '/';


// Manage pubs and syncing state.
// Defer to the SyncLocalAndHttp class for the nitty-gritty details.
export class Syncer1 {
    storage : IStorage | IStorageAsync;
    onChange : Emitter<SyncState>;
    state : SyncState;
    constructor(store : IStorage | IStorageAsync) {
        this.storage = store;
        this.onChange = new Emitter<SyncState>();
        this.state = {
            pubs: [],
            syncState: 'idle',
            lastSync: 0,
        }
    }
    removePub(url : string) {
        url = ensureTrailingSlash(url);
        let numBefore = this.state.pubs.length;
        this.state.pubs = this.state.pubs.filter(pub => pub.domain !== url);
        let numAfter = this.state.pubs.length;
        if (numBefore !== numAfter) {
            this.onChange.send(this.state);
        }
    }
    addPub(domain : string) {
        domain = ensureTrailingSlash(domain);

        // don't allow adding the same pub twice
        if (this.state.pubs.filter(pub => pub.domain === domain).length > 0) { return; }

        this.state.pubs.push({
            domain: domain,
            syncState: 'idle',
            lastSync: 0,
        });
        this.onChange.send(this.state);
    }
    async sync() {
        syncer1Logger.log('starting');
        this.state.syncState = 'syncing';
        this.onChange.send(this.state);
        let numSuccessfulPubs = 0;
        let numFailedPubs = 0;

        let syncPromises : {prom: Promise<any>, pub: any}[] = [];
        // start each pub syncing
        for (let pub of this.state.pubs) {
            syncer1Logger.log('starting pub:', pub.domain);
            pub.syncState = 'syncing';
            this.onChange.send(this.state);

            syncPromises.push({
                prom: syncLocalAndHttp(this.storage, pub.domain),
                pub: pub
            });
        }
        // when each one finishes (not necessarily in the same order), report its results
        for (let {prom, pub} of syncPromises) {
            let resultStats: SyncResultsLocalAndHttp = await prom;
            syncer1Logger.log('finished pub');
            syncer1Logger.log(JSON.stringify(resultStats, null, 2));
            if (resultStats.pull === null && resultStats.push === null) {
                pub.syncState = 'failure';
                numFailedPubs += 1;
            } else {
                pub.lastSync = Date.now();
                pub.syncState = 'success';
                numSuccessfulPubs += 1;
            }
            this.onChange.send(this.state);
        }

        // wait a moment so the user can keep track of what's happening
        await sleep(150);

        syncer1Logger.log('finished all pubs');
        this.state.lastSync = Date.now();
        if (numSuccessfulPubs > 0) { this.state.syncState = 'success'; }
        else if (numFailedPubs > 0) { this.state.syncState = 'failure'; }
        else { this.state.syncState = 'idle'; }  // apparently we have no pubs at all
        this.onChange.send(this.state);
    }
}

//================================================================================

let urlToGetDocuments = (domain : string, workspace : WorkspaceAddress) =>
    // domain should already end in a slash.
    // output is like https://mypub.com/earthstar-api/v1/+gardening.xxxxxxxx/documents
    `${domain}earthstar-api/v1/${workspace}/documents`;
let urlToPostDocuments = urlToGetDocuments;

interface ResultsLocalAndHttp {
    numIngested: number,
    numIgnored: number,
    numTotal: number,
};
interface SyncResultsLocalAndHttp {
    pull: ResultsLocalAndHttp | null,
    push: ResultsLocalAndHttp | null,
};

export let syncLocalAndHttp = async (storage: IStorage | IStorageAsync, domain: string): Promise<SyncResultsLocalAndHttp> => {
    syncerHttpLogger.log('existing database workspace:', storage.workspace);
    let resultStats: SyncResultsLocalAndHttp = {
        pull: null,
        push: null,
    };
    domain = ensureTrailingSlash(domain);

    // pull from server
    // this can 404 the first time, because the server only creates workspaces
    // when we push them
    syncerHttpLogger.log('pulling from ' + domain);
    let resp : any;
    try {
        resp = await fetch(urlToGetDocuments(domain, storage.workspace));
    } catch (e) {
        syncerHttpLogger.error('ERROR: could not connect to server');
        syncerHttpLogger.error(e.toString());
        return resultStats;
    }
    resultStats.pull = {
        numIngested: 0,
        numIgnored: 0,
        numTotal: 0,
    };
    if (resp.status === 404) {
        syncerHttpLogger.warn('    server 404: server does not know about this workspace yet');
    } else {
        let docs = await resp.json();
        resultStats.pull.numTotal = docs.length;
        for (let doc of docs) {
            const ingestResult = await storage.ingestDocument(doc, 'TODO: session id');
            if (ingestResult === WriteResult.Accepted) { resultStats.pull.numIngested += 1; }
            else { resultStats.pull.numIgnored += 1; }
        }
        syncerHttpLogger.log(JSON.stringify(resultStats.pull, null, 2));
    }

    // push to server
    syncerHttpLogger.log('pushing to ' + domain);
    let resp2 : any;
    try {
        const docs = await storage.documents({history: 'all'});
        resp2 = await fetch(urlToPostDocuments(domain, storage.workspace), {
            method: 'post',
            body:    JSON.stringify(docs),
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (e) {
        syncerHttpLogger.error('ERROR: could not connect to server');
        syncerHttpLogger.error(e.toString());
        return resultStats;
    }
    if (resp2.status === 404) {
        syncerHttpLogger.warn('    server 404: server is not accepting new workspaces');
    } else if (resp2.status === 403) {
        syncerHttpLogger.warn('    server 403: server is in readonly mode');
    } else {
        resultStats.push = await resp2.json() as ResultsLocalAndHttp;
        syncerHttpLogger.log(JSON.stringify(resultStats.push, null, 2));
    }

    return resultStats;
};
