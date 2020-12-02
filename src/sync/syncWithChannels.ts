import chalk = require('chalk');
import {
    Chan,
} from 'concurrency-friends';

import {
    AuthorAddress,
    Document,
    Path,
    StorageIsClosedError,
    SyncResults,
} from '../util/types';
import {
    Query,
} from '../storage/query';
import {
    IStorageAsync,
    IStorage,
} from '../storage/storageTypes';

import { StorageToAsync } from '../storage/storageToAsync';
import { StorageMemory } from '../storage/storageMemory';
import { ValidatorEs4 } from '../validator/es4';

let logSyncMain     = (msg: string) => console.log(chalk.whiteBright(msg));
let logSyncThread   = (msg: string) => console.log(chalk.white(      msg));
let logSyncProgress = (msg: string) => console.log(chalk.gray(       msg));
let logSyncCallback = (msg: string) => console.log(chalk.magenta(    msg));

//================================================================================
// TYPES

/** A Fingerprint uniquely identifies a document.  */
export type Fingerprint = [Path, AuthorAddress, number, string];  // path, author, timestamp, signature first N chars

//================================================================================
// CONFIGURATION AND TUNING

const SIGNATURE_PREFIX_CHARS = 12;  // only use the first N characters of signatures in fingerprints

const LOCAL_QUERY_BATCH = 100;  // query for this many docs at a time, using { limit: }
const REMOTE_QUERY_BATCH = 100;
const PUSH_BATCH = 100;  // push this many docs in one HTTP request
const PULL_BATCH = 100;  // pull this many docs in one HTTP request

//================================================================================
// GENERIC CHANNEL UTILS

// All channels in this file are null-terminated, meaning that a null
// sent into the channel signals that no more items are coming.
// The consumer of a channel is responsible for closing it when it reads a null,
// and propagating the null terminator into its output channels.

/**
 * Apply a function to items from the input channel, and put the results into the output channel.
 * Channels are null-terminated.
 * 
 * The map function may be an async function; it will be awaited.
 * 
 * The map function runs one-at-a-time and ordering of items is be preserved.
 * 
 * If the optional filter function is provided, it's applied after the map, to decide which items to keep.
 */
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
                logSyncThread(`${name} chanMap: processed 1 item`);
                await outChan.put(result);
            } else {
                logSyncThread(`${name} chanMap: processed 1 item but filtered it`);
            }
        }
    }
}

/**
 * Merge two series into a single series of pairs.
 * Inputs are assumed to be sorted and null-terminated.
 * 
 * Merging [a, b, x, null] and [a, b, c, y, z, null] produces:
 * ```
 *   [a,     a]   // matching items come together
 *   [b,     b]
 *   [null,  c]   // items only in one series appear in a pair with null
 *   [x,     null]
 *   [null,  y]
 *   [null,  z]   // when one series is done, the other one finishes
 *   null         // the output is null-terminated
 * ```
 * 
 * The sortKey function transforms an item into its' sort key.
 * This is used to know which items come first, and to decide which
 * items are equal to each other (if their sortKeys match, the items match).
 * Inputs must already be sorted by the same sortKey function.
 * 
 * If sortKey is `(x) => Math.floor(x)`, then:
 * ```
 *   inChan1: [1.1, 2.7, 4, null]
 *   inChan2: [1.1, 2.3, 3, null]
 *   output:
 *       [1.1,  1.1]
 *       [2.7,  2.3]  // same sort key, so they match together
 *       [3,    null]
 *       [null, 4]
 *       null
 * ```
 */
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
            if (key1 < key2) {
                logSyncThread(`${name} chanZip: item 1 goes first`);
                await outChan.put([item1, null]);
                item1 = await inChan1.get();
            } else if (key1 > key2) {
                logSyncThread(`${name} chanZip: item 2 goes first`);
                await outChan.put([null, item2]);
                item2 = await inChan2.get();
            } else {
                // they match
                logSyncThread(`${name} chanZip: items match`);
                await outChan.put([item1, item2]);
                item1 = await inChan1.get();
                item2 = await inChan2.get();
            }
        }
    }
}

/**
 * Accumulate items from inChan into a buffer array of length batchSize.
 * Each time the buffer fills up, send it to outChan.
 * When inChan finishes, send the last batch to outChan even if it's not full.
 * 
 * Channels are null-terminated.
 */
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

/**
 * Run the callback function on each item that arrives from inChan.
 * The function can be an async function; it is run one-at-a-time.
 * 
 * inChan is null-terminated.
 */
let chanForEach = async <T>(name: string, inChan: Chan<T | null>, fn: (t: T) => void | Promise<void>): Promise<void> => {
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
// CHANNEL TOOLS SPECIFIC TO EARTHSTAR

/**
 * Do a document query and send the result documents one at a time to outChan.
 * Send null when done.
 * 
 * If the query has a limit or limitBytes, do multiple queries as needed to advance
 * all the way through the documents.  The caller, by setting a limit in the query,
 * decides the batch size of the queries.
 */
let localQueryToChan = async (name: string, storage: IStorageAsync | IStorage, query: Query, outChan: Chan<Document | null>): Promise<void> => {
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
        if (query.limit === undefined && query.limitBytes === undefined) {
            // there was no limit, so we got everything in one shot.
            await outChan.put(null);
            logSyncThread(`${name} localQueryToChan: done in one shot.  exiting.`);
            return;
        } else {
            // there was some kind of limit.
            if (
                docs.length === 0
                || (query.limit !== undefined && docs.length < query.limit)
                // TODO: also check if sum(docs size) < limitBytes, to save a roundtrip
                ) {
                // we got nothing, so we're done,
                // or we got less than the limit, so we're done
                await outChan.put(null);
                logSyncThread(`${name} localQueryToChan: no more results, or docs.length < limit.  exiting.`);
                return;
            } else {
                // there's more to get
                logSyncThread(`${name} localQueryToChan: continuing...`);
                let lastDoc = docs[docs.length-1];
                query = {
                    ...query,
                    continueAfter: { path: lastDoc.path, author: lastDoc.author},
                };
            }
        }
    }
}

/** Convert a document to a fingerprint */
let docToFingerprint = (doc: Document): Fingerprint =>
    [doc.path, doc.author, doc.timestamp, doc.signature.slice(0, SIGNATURE_PREFIX_CHARS)];

// sort key functions

let fingerprintPathAndAuthor = ([path, author, timestamp, signature]: Fingerprint): any => {
    // sort fingerprints loosely just by path and author
    // this is used by zip
    return [path, author];
}
let fingerprintNewestFirst = ([path, author, timestamp, signature]: Fingerprint): any => {
    // sort winner first (higher timestamps come first, e.g. timestamp DESC)
    // this is used to decide which fingerprint in a zipped pair is the newer one
    // to decide if it should be pushed or pulled
    return [path, author, 9999999999999999 - timestamp, signature];
}

// given a fingerprint, look up the matching doc
let lookUpFingerprint = async (storage: IStorageAsync | IStorage, f: Fingerprint): Promise<Document | undefined> => {
    let [path, author, timestamp, signature] = f;
    let docs = await storage.documents({ path, author, history: 'all', limit: 1 });
    if (docs.length === 0) { return undefined; }
    let doc = docs[0];
    // got a doc with the same path and author.
    // if the one we got has a timestamp newer or same as the one we wanted, return it.
    if (doc.timestamp >= timestamp) { return doc; }
    // don't return an older one
    return undefined;
}

/**
 * Given a series of fingerprint pairs (from chanZip), figure out what needs to be pushed and pulled,
 * and send the fingerprints to the toPush or toPull channels.
 * 
 * If a pair of fingerprints match exactly, they will be skipped.
 * 
 * Channels are null-terminated.
 */
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
                let keyMe = fingerprintNewestFirst(fMe);
                let keyThem = fingerprintNewestFirst(fThem);
                if (keyMe < keyThem) {
                    // me is newer
                    logSyncThread(`${name} sortFingerprintsToPushAndPull: push this one (it's newer)`);
                    await toPush.put(fMe);
                } else if (keyMe > keyThem) {
                    // they are newer
                    logSyncThread(`${name} sortFingerprintsToPushAndPull: pull this one (it's newer)`);
                    await toPull.put(fThem);
                } else {
                    // both match
                    logSyncThread(`${name} sortFingerprintsToPushAndPull: they match; no sync needed; skip`);
                    continue;
                }
            }
        }
    }
}

//================================================================================

/**
 * Do a complete sync, then return stats about how many documents were sent in each direction.
 */
// TODO: how to cancel this when it's in-progress?
export let incrementalSync = async (storage1: IStorageAsync | IStorage, storage2: IStorageAsync | IStorage): Promise<SyncResults> => {
    logSyncMain(`== incrementalSync: starting.  workspace = ${storage1.workspace}`);

    /*
        Graph of threads "o" and the channels that connect them "|".

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
    // prepare channels.
    // each uses null to signal completion.
    // each will be closed by the thread that reads from it, when it's completed.

    // fingerprints from local storage
    let chDocs1 = new Chan<Document | null>(0);
    let chFings1 = new Chan<Fingerprint | null>(0);

    // fingerprints from remote storage
    let chDocs2 = new Chan<Document | null>(0);
    let chFings2 = new Chan<Fingerprint | null>(0);

    // compare them
    let chPairs = new Chan<[Fingerprint | null, Fingerprint | null] | null>(0);

    // to push
    let chFingsToPush = new Chan<Fingerprint | null>(0);
    let chDocsToPush = new Chan<Document | null>(0);
    let chDocPushBatches = new Chan<Document[] | null>(0);

    // to pull
    let chFingsToPull = new Chan<Fingerprint | null>(0);
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
        localQueryToChan(chalk.red('1 query'), storage1, { history: 'all', limit: LOCAL_QUERY_BATCH }, chDocs1),
        chanMap(chalk.red(' 1 docToFingerprint'), chDocs1, chFings1, docToFingerprint),

        // fingerprints from remote storage
        // TODO: remote query returning fingerprints, instead of getting docs and converting them to fingerprints locally
        localQueryToChan(chalk.yellow('        2 query'), storage2, { history: 'all', limit: REMOTE_QUERY_BATCH }, chDocs2),
        chanMap(chalk.yellow('         2 docToFingerprint'), chDocs2, chFings2, docToFingerprint),

        // compare them
        chanZip(chalk.green('    - zip'), chFings1, chFings2, chPairs, fingerprintPathAndAuthor),
        // figure out what to push and pull
        sortFingerprintsToPushAndPull(chalk.green('    - sort into push and pull'), chPairs, chFingsToPush, chFingsToPull),

        // to push
        // look up fingerprints in local storage1, to get documents
        chanMap(chalk.cyan('1 look up fingerprint'), chFingsToPush, chDocsToPush,
            (f: Fingerprint): Document => lookUpFingerprint(storage1, f) as any as Document,
            (doc: Document | undefined) => doc !== undefined),
        // batch the documents
        chanBatch(chalk.cyan(' 1 batch docs to push'), chDocsToPush, chDocPushBatches, PUSH_BATCH),
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
        chanBatch(chalk.blueBright('        2 batch fings to pull'), chFingsToPull, chFingPullBatches, PULL_BATCH),
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

    // wait for threads to finish.
    // if anything throws an exception it will surface here.
    logSyncMain('== incrementalSync: waiting for threads to finish');
    let ii = 0;
    for (let thread of threads) {
        await thread;
        ii += 1;
        logSyncProgress(`== incrementalSync: thread ${ii} of ${threads.length} has finished`);
    }
    logSyncMain('== incrementalSync: done');

    // make sure all channels were closed, to check for bugs
    for (let chan of chans) {
        if (!chan.isClosed) {
            console.warn('== incrementalSync WARNING: a channel was not closed');
            chan.close();
        }
    }

    return syncResults;
}
