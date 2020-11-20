import {
    AuthorAddress,
    Document,
    EarthstarError,
    NetworkError,
    Path,
    WriteResult,
    isErr,
} from '../util/types';
import {
    IStorage3,
} from './types3';
import {
    Query3,
} from './query3';
import { Storage3Memory } from './storage3Memory';
import { ValidatorEs4 } from '../validator/es4';
import { logDebug } from '../util/log';
import { sleep } from '../util/helpers';
import { Storage3Base } from './storage3Base';

//================================================================================

export type Fingerprint = [Path, AuthorAddress, number, string];  // path, author, timestamp, signaturePrefix

/**
 * Iterate through a query.
 * 
 * If the query has a limit or limitBytes, does multiple queries to
 * advance all the way through the documents.  The caller decides
 * what the limit should be.
 */
export async function* localQueryIterator(storage: IStorage3, query: Query3): AsyncGenerator<Document, void, unknown> {
    while (true) {
        let docs = storage.documents(query);
        logDebug(`query got ${docs.length} docs`);
        if (docs.length === 0) {
            // no results.  we're done.
            logDebug(`    exhausted`);
            return;
        }
        for (let doc of docs) {
            yield doc;
        }
        if (query.limit === undefined && query.limitBytes === undefined) {
            // we got everything at once, so we're done
            logDebug(`    done in one shot`);
            return;
        }
        let lastDoc = docs[docs.length-1];
        logDebug(`    continuing...`);
        query = {
            ...query,
            continueAfter: { path: lastDoc.path, author: lastDoc.author},
        };
    }
}

/** Map a doc async-iterator to fingerprints. */
export async function* docToFingerprintIterator(docs: AsyncGenerator<Document, void, unknown>): AsyncGenerator<Fingerprint, void, unknown> {
    for await (let doc of docs) {
        yield [doc.path, doc.author, doc.timestamp, doc.signature];
    }
}

/**
 * Given two fingerprint async-iterators,
 * return a series of pairs [Fingerprint | undefined, Fingerprint | undefined].
 * 
 * For example, using integers instead of fingerprints for this example:
 *     * [1, undefined] -- only fIter1 had item #1
 *     * [undefined, 2] -- only fIter2 had item #2
 *     * [3, 3] -- both had item #3
 *     * [4, undefined] -- only fIter1 had item #4
 * 
 * Fingerprints are considered equal if the path and author match.
 * 
 * The sequence ends when both input iterators are exhausted.
 * 
 * Assumes the iterators are sorted in ascending path-then-author order.
 */
export async function* fingerprintIteratorZipper(fIter1: AsyncGenerator<Fingerprint, void, unknown>, fIter2: AsyncGenerator<Fingerprint, void, unknown>):
    AsyncGenerator<[Fingerprint | undefined, Fingerprint | undefined], void, unknown>
    {
    let f1: Fingerprint | undefined = (await fIter1.next()).value as (Fingerprint | undefined);
    let f2: Fingerprint | undefined = (await fIter2.next()).value as (Fingerprint | undefined);
    while (true) {
        if (f1 === undefined) {
            if (f2 === undefined) {
                // both are spent
                return;
            } else {
                // f1 is spent, f2 is still going
                yield [undefined, f2];
                f2 = (await fIter2.next()).value as (Fingerprint | undefined);
            }
        } else {
            if (f2 === undefined) {
                // f1 is still going, f2 is spent
                yield [f1, undefined];
                f1 = (await fIter1.next()).value as (Fingerprint | undefined);
            } else {
                // both are still going.  compare them.
                let [f1path, f1author, f1timestamp, f1sig] = f1;
                let [f2path, f2author, f2timestamp, f2sig] = f2;
                let eq = f1path === f2path && f1author === f2author;
                let f1SortsFirst = (f1path < f2path) || (f1path === f2path && f1author > f2author);
                if (eq) {
                    // they match; yield both
                    yield [f1, f2];
                    f1 = (await fIter1.next()).value as (Fingerprint | undefined);
                    f2 = (await fIter2.next()).value as (Fingerprint | undefined);
                } else if (f1SortsFirst) {
                    // f1 sorts first, revealing a gap in f2
                    yield [f1, undefined];
                    f1 = (await fIter1.next()).value as (Fingerprint | undefined);
                } else {
                    // f2 sorts first, revealing a gap in f1
                    yield [undefined, f2];
                    f2 = (await fIter2.next()).value as (Fingerprint | undefined);
                }
            }
        }
    }
}

interface Action {
    action: 'nop-equal' | 'push-missing' | 'pull-missing' | 'push-newer' | 'pull-newer',
    f1: Fingerprint | undefined,
    f2: Fingerprint | undefined,
}
export async function* zipperToAction(zipper: AsyncGenerator<[Fingerprint | undefined, Fingerprint | undefined], void, unknown>):
    AsyncGenerator<Action, void, unknown>
    {
    for await (let [f1, f2] of zipper) {
            if (f1 === undefined) {
                yield { action: 'pull-missing', f1, f2 };
            }
            else if (f2 === undefined) {
                yield { action: 'push-missing', f1, f2 };
            }
            else {
                let [path1, author1, timestamp1, sig1] = f1;
                let [path2, author2, timestamp2, sig2] = f2;
                // the zipper ensures that path and author already match
                let p1Newer = timestamp1 > timestamp2 || (timestamp1 === timestamp2 && sig1 < sig2);
                let eq = (timestamp1 === timestamp2 && sig1 === sig2);
                if (eq) {
                    yield { action: 'nop-equal', f1, f2 };
                } else if (p1Newer) {
                    yield { action: 'push-newer', f1, f2 };
                } else {
                    yield { action: 'pull-newer', f1, f2 };
                }
            }
    }
}

/**
 * Return the document matching the fingerprint, or a newer one from the same author and path if there is one.
 */
export let lookupFingerprint = (storage: IStorage3, fingerprint: Fingerprint) : Document | undefined => {
    let [path, author, timestamp, sig] = fingerprint;
    return storage.documents({ path, author, timestamp_gt: timestamp-1 })[0];
}

export class PushBuffer {
    _docs: Document[] = [];
    _sizeThreshold: number = 3 * 1000000;  // 3 mb
    _sizeTotal: number = 0;
    _storage: IStorage3;
    constructor(storage: IStorage3) {
        this._storage = storage;
    }
    async push(doc: Document) {
        this._docs.push(doc);
        this._sizeTotal += doc.content.length;
        if (this._sizeTotal > this._sizeThreshold) {
            await this.flush();
        }
    }
    async flush() {
        // TODO: batch upload to storage
        this._docs = [];
    }
}


