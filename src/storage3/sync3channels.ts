import {
    Chan,
} from 'concurrency-friends';

import {
    AuthorAddress,
    Document,
    Path,
    StorageIsClosedError,
} from '../util/types';
import { logDebug } from '../util/log';
import { sleep, sorted } from '../util/helpers';
import {
    Query3,
} from './query3';
import {
    IStorage3Async,
} from './types3';
import { Storage3ToAsync } from './storage3toasync';
import { Storage3Memory } from './storage3Memory';
import { ValidatorEs4 } from '../validator/es4';
import { fingerprintIteratorZipper } from './sync3incremental';
import { time } from 'console';
import { sign } from 'crypto';



type Fingerprint = [Path, AuthorAddress, number, string];  // path, author, timestamp, signature

/**
 * Do a query and send the result documents to a Chan, followed by null when done.
 * 
 * If the query has a limit or limitBytes, do multiple queries to advance
 * all the way through the documents.
 * The caller decides what the limit should be.
 */
let localQueryToChan = async (storage: IStorage3Async, query: Query3, outChan: Chan<Document | null>): Promise<void> => {
    let docs: Document[] = [];
    while (true) {
        try {
            docs = await storage.documents(query);
        } catch (err) {
            if (err instanceof StorageIsClosedError) {
                logDebug(`    queryToChan: storage was closed`);
                await outChan.put(null);
                return;
            } else {
                throw err;
            }
        }
        logDebug(`queryToChan: got ${docs.length} docs`);
        for (let doc of docs) {
            await outChan.put(doc);
        }
        if (docs.length === 0) {
            // no results.  we're done.
            logDebug(`    queryToChan: no more results.  exiting.`);
            await outChan.put(null);
            return;
        }
        if (query.limit === undefined && query.limitBytes === undefined) {
            // we got everything at once, so we're done
            logDebug(`    queryToChan: done in one shot.  exiting.`);
            await outChan.put(null);
            return;
        }
        logDebug(`    queryToChan: continuing...`);
        let lastDoc = docs[docs.length-1];
        query = {
            ...query,
            continueAfter: { path: lastDoc.path, author: lastDoc.author},
        };
    }
}

let chanMap = async <T, R>(inChan: Chan<T | null>, outChan: Chan<R | null>, fn: (item: T) => R): Promise<void> => {
    while (true) {
        let item = await inChan.get();
        if (item === null) {
            inChan.close();
            await outChan.put(null);
            return;
        } else {
            await outChan.put(fn(item));
        }
    }
}

// merge the inputs into a series of pairs.
// assume the inputs are already sorted.
let chanZip = async <T>(inChan1: Chan<T | null>, inChan2: Chan<T | null>, outChan: Chan<[T | null, T | null] | null>, sortKey: (item: T) => any) => {
    let item1 = await inChan1.get();
    let item2 = await inChan2.get();
    while (true) {
        if (item1 === null && item2 === null) {
            inChan1.close();
            inChan2.close();
            await outChan.put(null);
            return;
        } else if (item1 === null) {
            await outChan.put([null, item2]);
            item2 = await inChan2.get();
        } else if (item2 === null) {
            await outChan.put([item1, null]);
            item1 = await inChan1.get();
        } else {
            let key1 = sortKey(item1);
            let key2 = sortKey(item2);
            if (key1 === key2) {
                await outChan.put([item1, item2]);
                item1 = await inChan1.get();
                item2 = await inChan2.get();
            } else if (key1 < key2) {
                await outChan.put([item1, null]);
                item1 = await inChan1.get();
            } else {
                await outChan.put([null, item2]);
                item2 = await inChan2.get();
            }
        }
    }
}

let docToFingerprint = (doc: Document): Fingerprint =>
    [doc.path, doc.author, doc.timestamp, doc.signature];
let fingerprintSortKey = ([path, author, timestamp, signature]: Fingerprint): any => {
    // sort winner first (lesser than means winner)
    return [path, author, 9999999999999999 - timestamp, signature];
}

let sortFingerprintsToPushAndPull = async (inChan: Chan<[Fingerprint | null, Fingerprint | null] | null>, toPush: Chan<Fingerprint | null>, toPull: Chan<Fingerprint | null>): Promise<void> => {
    while (true) {
        let pair = await inChan.get();
        if (pair === null) {
            await toPush.put(null);
            await toPull.put(null);
            inChan.close();
            return;
        } else {
            let [fMe, fThem] = pair;
            if (fMe === null && fThem === null) { continue; }
            else if (fMe === null) {
                await toPull.put(fThem);
            } else if (fThem === null) {
                await toPush.put(fMe);
            } else {
                let keyMe = fingerprintSortKey(fMe);
                let keyThem = fingerprintSortKey(fThem);
                if (keyMe === keyThem) { continue; }
                else if (keyMe < keyThem) {
                    // me is newer
                    await toPush.put(fMe);
                } else {
                    await toPull.put(fThem);
                }
            }
        }
    }
}

// accumulate items from inChan into a buffer of length batchSize.
// when the buffer is full, send it to outChan.
// TODO: timeouts
let chanBatch = async <T>(inChan: Chan<T | null>, outChan: Chan<T[] | null>, batchSize: number): Promise<void> => {
    let buffer: T[] = [];
    while (true) {
        let item = await inChan.get();
        if (item === null) {
            inChan.close();
            if (buffer.length > 0) {
                await outChan.put(buffer);
            }
            await outChan.put(null);
            return;
        } else {
            buffer.push(item);
            if (buffer.length === batchSize) {
                await outChan.put(buffer);
                buffer = [];
            }
        }
    }
}


//================================================================================
// MAIN

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
    o chanBatch            o chanBatch
    |  chFingPushBatches   |  chFingPullBatches

*/

let workspace = '+test.abc';
let storage1 = new Storage3ToAsync(new Storage3Memory([ValidatorEs4], workspace));
let storage2 = new Storage3ToAsync(new Storage3Memory([ValidatorEs4], workspace));

// set up channels
let chDocs1 = new Chan<Document | null>();
let chDocs2 = new Chan<Document | null>();
let chFings1 = new Chan<Fingerprint | null>();
let chFings2 = new Chan<Fingerprint | null>();
let chPairs = new Chan<[Fingerprint | null, Fingerprint | null] | null>();
let chFingsToPush = new Chan<Fingerprint | null>();
let chFingsToPull = new Chan<Fingerprint | null>();
let chFingPushBatches = new Chan<Fingerprint[] | null>();
let chFingPullBatches = new Chan<Fingerprint[] | null>();

// launch threads
localQueryToChan(storage1, { history: 'all', limit: 100 }, chDocs1);
localQueryToChan(storage2, { history: 'all', limit: 100 }, chDocs2);
chanMap(chDocs1, chFings1, docToFingerprint);
chanMap(chDocs2, chFings2, docToFingerprint);
chanZip(chFings1, chFings2, chPairs, fingerprintSortKey);
sortFingerprintsToPushAndPull(chPairs, chFingsToPush, chFingsToPull);
chanBatch(chFingsToPush, chFingPushBatches, 100);
chanBatch(chFingsToPull, chFingPullBatches, 100);







