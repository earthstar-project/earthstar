import {
    Chan,
} from 'concurrency-friends';
import chalk = require('chalk');

import {
    AuthorAddress,
    Document,
    Path,
    StorageIsClosedError,
    SyncResults,
} from '../util/types';
import {
    Query3,
} from './query3';
import {
    IStorage3Async,
    IStorage3,
} from './types3';

import { Storage3ToAsync } from './storage3toasync';
import { Storage3Memory } from './storage3Memory';
import { ValidatorEs4 } from '../validator/es4';

export type Fingerprint = [Path, AuthorAddress, number, string];  // path, author, timestamp, signature

//================================================================================
// GENERIC CHANNEL UTILS

let logSyncMain     = (msg: string) => console.log(chalk.whiteBright(msg));
let logSyncThread   = (msg: string) => console.log(chalk.white(      msg));
let logSyncProgress = (msg: string) => console.log(chalk.gray(       msg));
let logSyncCallback = (msg: string) => console.log(chalk.magenta(    msg));

let chanMap = async <T, R>(name: string, inChan: Chan<T | null>, outChan: Chan<R | null>, map: (item: T) => R | Promise<R>, filter?: (result: R) => boolean): Promise<void> => {
    logSyncThread(`${name} chanMap: starting`);
    while (true) {
        let item = await inChan.get();
        if (item === null) {
            inChan.close();
            await outChan.put(null);
            logSyncThread(`${name} chanMap: exiting`);
            return;
        } else {
            let result: R = await map(item);
            if (filter === undefined || filter(result) === true) {
                await outChan.put(result);
            }
        }
    }
}

// merge the inputs into a series of pairs.
// assume the inputs are already sorted.
let chanZip = async <T>(name: string, inChan1: Chan<T | null>, inChan2: Chan<T | null>, outChan: Chan<[T | null, T | null] | null>, sortKey: (item: T) => any) => {
    logSyncThread(`${name} chanZip: starting...`);
    let item1 = await inChan1.get();
    let item2 = await inChan2.get();
    logSyncThread(`${name} chanZip: got first item from each side...`);
    while (true) {
        if (item1 === null && item2 === null) {
            logSyncThread(`${name} chanZip: both sides are exhausted`);
            inChan1.close();
            inChan2.close();
            await outChan.put(null);
            logSyncThread(`${name} chanZip: exiting`);
            return;
        } else if (item1 === null) {
            logSyncThread(`${name} chanZip: side 1 is exhausted; side 2 continues`);
            await outChan.put([null, item2]);
            item2 = await inChan2.get();
        } else if (item2 === null) {
            logSyncThread(`${name} chanZip: side 2 is exhausted; side 1 continues`);
            await outChan.put([item1, null]);
            item1 = await inChan1.get();
        } else {
            let key1 = sortKey(item1);
            let key2 = sortKey(item2);
            // TODO: deep equals
            if (key1 === key2) {
                logSyncThread(`${name} chanZip: items match`);
                await outChan.put([item1, item2]);
                item1 = await inChan1.get();
                item2 = await inChan2.get();
            } else if (key1 < key2) {
                logSyncThread(`${name} chanZip: item 1 goes first`);
                await outChan.put([item1, null]);
                item1 = await inChan1.get();
            } else {
                logSyncThread(`${name} chanZip: item 2 goes first`);
                await outChan.put([null, item2]);
                item2 = await inChan2.get();
            }
        }
    }
}

// accumulate items from inChan into a buffer of length batchSize.
// when the buffer is full, send it to outChan.
// TODO: timeouts
let chanBatch = async <T>(name: string, inChan: Chan<T | null>, outChan: Chan<T[] | null>, batchSize: number): Promise<void> => {
    logSyncThread(`${name} chanBatch(${batchSize}): starting`);
    let buffer: T[] = [];
    while (true) {
        let item = await inChan.get();
        if (item === null) {
            inChan.close();
            if (buffer.length > 0) {
                logSyncThread(`${name} chanBatch: sending final batch of ${buffer.length} items`);
                await outChan.put(buffer);
            }
            await outChan.put(null);
            logSyncThread(`${name} chanBatch: exiting`);
            return;
        } else {
            buffer.push(item);
            if (buffer.length === batchSize) {
                logSyncThread(`${name} chanBatch: sending a batch of ${buffer.length} items`);
                await outChan.put(buffer);
                buffer = [];
            }
        }
    }
}

let chanForEach = async <T>(name: string, inChan: Chan<T | null>, fn: (t: T) => Promise<void>): Promise<void> => {
    logSyncThread(`${name} chanForEach: starting`);
    while (true) {
        let item = await inChan.get();
        if (item === null) {
            inChan.close();
            logSyncThread(`${name} chanForEach: exiting`);
            return;
        } else {
            await fn(item);
        }
    }
}

//================================================================================

/**
 * Do a query and send the result documents to a Chan, followed by null when done.
 * 
 * If the query has a limit or limitBytes, do multiple queries to advance
 * all the way through the documents.
 * The caller decides what the limit should be.
 */
let localQueryToChan = async (name: string, storage: IStorage3Async | IStorage3, query: Query3, outChan: Chan<Document | null>): Promise<void> => {
    logSyncThread(`${name} localQueryToChan: starting`);
    let docs: Document[] = [];
    while (true) {
        try {
            docs = await storage.documents(query);
        } catch (err) {
            if (err instanceof StorageIsClosedError) {
                await outChan.put(null);
                logSyncThread(`${name} localQueryToChan: storage was closed.  exiting.`);
                return;
            } else {
                throw err;
            }
        }
        logSyncThread(`${name} localQueryToChan: got ${docs.length} docs`);
        for (let doc of docs) {
            await outChan.put(doc);
        }
        if (docs.length === 0) {
            // no results.  we're done.
            await outChan.put(null);
            logSyncThread(`${name} localQueryToChan: no more results.  exiting.`);
            return;
        }
        if (query.limit === undefined && query.limitBytes === undefined) {
            // we got everything at once, so we're done
            await outChan.put(null);
            logSyncThread(`${name} localQueryToChan: done in one shot.  exiting.`);
            return;
        }
        logSyncThread(`${name} localQueryToChan: continuing...`);
        let lastDoc = docs[docs.length-1];
        query = {
            ...query,
            continueAfter: { path: lastDoc.path, author: lastDoc.author},
        };
    }
}


let docToFingerprint = (doc: Document): Fingerprint =>
    [doc.path, doc.author, doc.timestamp, doc.signature];

let fingerprintSortKey = ([path, author, timestamp, signature]: Fingerprint): any => {
    // sort winner first (lesser than means winner)
    return [path, author, 9999999999999999 - timestamp, signature];
}

// given a fingerprint, look up the matching doc
let lookUpFingerprint = async (storage: IStorage3Async | IStorage3, f: Fingerprint): Promise<Document | undefined> => {
    let [path, author, timestamp, signature] = f;
    let docs = await storage.documents({ path, author, limit: 1 });
    if (docs.length === 0) { return undefined; }
    let doc = docs[0];
    // return the same doc or a newer one
    if (doc.timestamp >= timestamp) { return doc; }
    // don't return an older one
    return undefined;
}

let sortFingerprintsToPushAndPull = async (name: string, inChan: Chan<[Fingerprint | null, Fingerprint | null] | null>, toPush: Chan<Fingerprint | null>, toPull: Chan<Fingerprint | null>): Promise<void> => {
    logSyncThread(`${name} sortFingerprintsToPushAndPull: starting`);
    while (true) {
        let pair = await inChan.get();
        if (pair === null) {
            await toPush.put(null);
            await toPull.put(null);
            inChan.close();
            logSyncThread(`${name} sortFingerprintsToPushAndPull: exiting`);
            return;
        } else {
            let [fMe, fThem] = pair;
            if (fMe === null && fThem === null) { continue; }
            else if (fMe === null) {
                logSyncThread(`${name} sortFingerprintsToPushAndPull: pull this one (we don't have it)`);
                await toPull.put(fThem);
            } else if (fThem === null) {
                logSyncThread(`${name} sortFingerprintsToPushAndPull: push this one (they don't have it)`);
                await toPush.put(fMe);
            } else {
                let keyMe = fingerprintSortKey(fMe);
                let keyThem = fingerprintSortKey(fThem);
                // TODO: deep equals
                if (keyMe === keyThem) {
                    logSyncThread(`${name} sortFingerprintsToPushAndPull: they match; skip`);
                    continue;
                }
                else if (keyMe < keyThem) {
                    // me is newer
                    logSyncThread(`${name} sortFingerprintsToPushAndPull: push this one (it's newer)`);
                    await toPush.put(fMe);
                } else {
                    logSyncThread(`${name} sortFingerprintsToPushAndPull: pull this one (it's newer)`);
                    await toPull.put(fThem);
                }
            }
        }
    }
}

//================================================================================

export let incrementalSync = async (storage1: IStorage3Async | IStorage3, storage2: IStorage3Async | IStorage3): Promise<SyncResults> => {
    logSyncMain(`== incrementalSync: starting.  workspace = ${storage1.workspace}`);

    /*

        storage1               storage2
        (local)                (remote)

        o localQueryToChan     o localQueryToChan  TODO: remoteQueryToChan
        |  chDocs1             |  chDocs2
        o docsToFing           o docsToFing
        |  chFings1            |  chFings2
        \                      /
                    o chanZip
                    |  chPairs
                    o sortFingerprintsToPushAndPull
        /                      \
        |  chFingsToPush       |  chFingsToPull
        o chanMap lookupFing   o chanBatch
        |  chDocsToPush        |  chFingPullBatches
        o chanBatch            o chanMap fetch fingerprint batches
        |  chDocPushBatches    |  chPulledDocs
        o chanForEach push     o chanForEach ingest


        red         yellow
              green
        cyan        blue

    */

    //------------------------------------------------------------
    // prepare channels
    // each uses null to signal completion.
    // each will be closed by the thread that gets from it, when it's completed.

    // fingerprints from local storage
    let chDocs1 = new Chan<Document | null>(0);
    let chFings1 = new Chan<Fingerprint | null>(0);

    // fingerprints from remote storage
    let chDocs2 = new Chan<Document | null>(0);
    let chFings2 = new Chan<Fingerprint | null>(0);

    // compare them
    let chPairs = new Chan<[Fingerprint | null, Fingerprint | null] | null>(0);

    // to push
    let chFingsToPush = new Chan<Fingerprint | null>(300);
    let chDocsToPush = new Chan<Document | null>(0);
    let chDocPushBatches = new Chan<Document[] | null>(0);

    // to pull
    let chFingsToPull = new Chan<Fingerprint | null>(300);
    let chFingPullBatches = new Chan<Fingerprint[] | null>(0);
    let chPulledDocs = new Chan<Document[] | null>(0);

    let chans : Chan<any>[] = [
        chDocs1, chFings1,
        chDocs2, chFings2,
        chPairs,
        chFingsToPush, chDocsToPush, chDocPushBatches,
        chFingsToPull, chFingPullBatches, chPulledDocs,
    ];

    //------------------------------------------------------------
    // launch threads

    logSyncMain('== incrementalSync: starting threads');

    let syncResults = { numPushed: 0, numPulled: 0 };

    let threads: Promise<void>[] = [
        // fingerprints from local storage
        localQueryToChan(chalk.red('1 query'), storage1, { history: 'all', limit: 100 }, chDocs1),
        chanMap(chalk.red(' 1 docToFingerprint'), chDocs1, chFings1, docToFingerprint),

        // fingerprints from remote storage
        // TODO: remote query returning fingerprints, instead of getting docs and converting them to fingerprints locally
        localQueryToChan(chalk.yellow('        2 query'), storage2, { history: 'all', limit: 100 }, chDocs2),
        chanMap(chalk.yellow('         2 docToFingerprint'), chDocs2, chFings2, docToFingerprint),

        // compare them
        chanZip(chalk.green('    - zip'), chFings1, chFings2, chPairs, fingerprintSortKey),
        // figure out what to push and pull
        sortFingerprintsToPushAndPull(chalk.green('    - sort into push and pull'), chPairs, chFingsToPush, chFingsToPull),

        // to push
        // look up fingerprints in local storage1, to get documents
        chanMap(chalk.cyan('1 look up fingerprint'), chFingsToPush, chDocsToPush,
            (f: Fingerprint): Document => lookUpFingerprint(storage1, f) as any as Document,
            (doc: Document | undefined) => doc !== undefined),
        // batch the documents
        chanBatch(chalk.cyan(' 1 batch docs to push'), chDocsToPush, chDocPushBatches, 100),
        // push the batch to remote storage2
        chanForEach(chalk.cyan('  1 push doc batch'), chDocPushBatches, async (docBatch: Document[]) => {
            logSyncCallback(`  1 push doc batch: pushing batch of ${docBatch.length} docs to remote storage`);
            syncResults.numPushed += docBatch.length;
            // TODO: do this remotely
            for (let doc of docBatch) {
                await storage2.ingestDocument(doc, storage1.sessionId);
            }
        }),

        // to pull
        // batch the fingerprints to pull
        chanBatch(chalk.blueBright('        2 batch fings to pull'), chFingsToPull, chFingPullBatches, 100),
        // look up batch of fingerprints in remote storage2, get back a batch of docs
        chanMap(chalk.blueBright('         2 look up fingerprint batches remotely'), chFingPullBatches, chPulledDocs, async (fingBatch: Fingerprint[]): Promise<Document[]> => {
            // TODO: do this remotely
            logSyncCallback(`         2 look up...: pulling batch of ${fingBatch.length} fingerprints, getting docs from remote storage`);
            let docs: Document[] = [];
            for (let fing of fingBatch) {
                let doc = await lookUpFingerprint(storage2, fing);
                if (doc !== undefined) { docs.push(doc); }
            }
            return docs;
        }),
        // locally ingest the batch of docs we got back from remote storage2
        chanForEach(chalk.blueBright('          2 ingest pulled docs'), chPulledDocs, async (docBatch: Document[]) => {
            logSyncCallback(`          2 ingest...: ingesting batch of ${docBatch.length} docs from remote storage to local storage`);
            for (let doc of docBatch) {
                await storage1.ingestDocument(doc, storage2.sessionId);
                syncResults.numPulled += 1;
            }
        }),
    ];

    // wait for threads to finish
    logSyncMain('== incrementalSync: waiting for threads to finish');
    let ii = 0;
    for (let thread of threads) {
        await thread;
        ii += 1;
        logSyncProgress(`== incrementalSync: thread ${ii} of ${threads.length} has finished`);
    }
    logSyncMain('== incrementalSync: done');

    // make sure all channels are closed
    for (let chan of chans) {
        if (!chan.isClosed) {
            console.warn('== incrementalSync WARNING: a channel was not closed');
            chan.close();
        }
    }

    return syncResults;
}

/*
let workspace = '+test.abc';
let storage1 = new Storage3ToAsync(new Storage3Memory([ValidatorEs4], workspace));
let storage2 = new Storage3ToAsync(new Storage3Memory([ValidatorEs4], workspace));
incrementalSync(storage1, storage2);
*/
